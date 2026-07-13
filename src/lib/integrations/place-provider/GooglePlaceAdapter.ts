import type { Coordinates, Destination } from "@/lib/domain/station";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import { haversineMeters } from "@/lib/geo/haversine";
import type { PlaceProviderPort } from "./PlaceProviderPort";

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_URL = "https://places.googleapis.com/v1/places";
const SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.websiteUri";
const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location,businessStatus,websiteUri";
const REQUEST_TIMEOUT_MS = 5000;
/**
 * 位置バイアスの半径(メートル)。駅から離れた目的地でも検索できるよう、
 * 徒歩圏を大きく超える範囲を許容しつつ、他都市の同名店舗は除外できる程度に設定する。
 */
const LOCATION_BIAS_RADIUS_METERS = 30000;
/**
 * 同名店舗の距離フィルタに使う上限距離(メートル)。locationBias はソフトな優先度付け
 * であり、Google側がバイアス半径を超えた場所も返しうるため、バイアス半径そのものを
 * 上限にすると近隣の妥当な候補まで誤って弾く恐れがある。バイアス半径を「大きく超える」
 * 場合のみ誤検索とみなせるよう、余裕を持たせた倍率をハード上限として設定する。
 */
const MAX_CANDIDATE_DISTANCE_METERS = LOCATION_BIAS_RADIUS_METERS * 2;

type GoogleBusinessStatus =
  | "BUSINESS_STATUS_UNSPECIFIED"
  | "OPERATIONAL"
  | "CLOSED_TEMPORARILY"
  | "CLOSED_PERMANENTLY"
  | "FUTURE_OPENING";

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  businessStatus?: GoogleBusinessStatus;
  websiteUri?: string;
}

/**
 * Google の businessStatus を Destination.businessStatus に変換する。
 * CLOSED_PERMANENTLY は呼び出し側で候補自体を除外するため、ここには渡らない想定。
 * FUTURE_OPENING・UNSPECIFIED・未指定(施設種別によっては営業状態自体が無い)は
 * 「確認できない」として扱い、フィールドを付与しない(断定しない設計)。
 */
function toDestinationBusinessStatus(
  status: GoogleBusinessStatus | undefined
): Destination["businessStatus"] {
  if (status === "OPERATIONAL") return "operational";
  if (status === "CLOSED_TEMPORARILY") return "closed_temporarily";
  return undefined;
}

/** near から大きく離れた同名店舗を除外するための距離判定。位置情報が無い候補は判定不能として除外しない。 */
function isWithinCandidateDistance(place: GooglePlace, near: Coordinates): boolean {
  if (!place.location) return true;
  const distance = haversineMeters(
    near.lat,
    near.lng,
    place.location.latitude,
    place.location.longitude
  );
  return distance <= MAX_CANDIDATE_DISTANCE_METERS;
}

/**
 * Google Places API (Text Search / Place Details, New) を使う本番用アダプター。
 * 最寄り駅候補は Google 側が返さないため、位置情報から stationProvider で解決する。
 */
export class GooglePlaceAdapter implements PlaceProviderPort {
  constructor(
    private readonly apiKey: string,
    private readonly stationProvider: StationProviderPort
  ) {}

  async searchPlaces(query: string, near?: Coordinates | null): Promise<Destination[]> {
    const normalized = query.trim();
    if (!normalized) return [];

    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: normalized,
        languageCode: "ja",
        regionCode: "JP",
        ...(near
          ? {
              locationBias: {
                circle: {
                  center: { latitude: near.lat, longitude: near.lng },
                  radius: LOCATION_BIAS_RADIUS_METERS,
                },
              },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as { places?: GooglePlace[] };
    const places = data.places ?? [];

    const filtered = places.filter((place) => {
      // 閉店確定の候補は誤案内になるため候補一覧に出さない
      // (一時休業は除外せず注記のみ、docs/04_EXIT_SELECTION_DESIGN.md と同じ設計思想)。
      if (place.businessStatus === "CLOSED_PERMANENTLY") return false;
      if (near && !isWithinCandidateDistance(place, near)) return false;
      return true;
    });

    return Promise.all(filtered.map((place) => this.toDestination(place)));
  }

  async getPlace(placeId: string): Promise<Destination | null> {
    if (!placeId.trim()) return null;

    // languageCode はヘッダーではなくクエリパラメータで指定する必要がある
    // (Place Details, New の仕様)。省略するとGoogle既定言語(英語名等)が
    // 返り、日本語検索で選んだ場所なのに目的地名が英語表記になってしまう。
    const res = await fetch(
      `${DETAILS_URL}/${encodeURIComponent(placeId)}?languageCode=ja&regionCode=JP`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": DETAILS_FIELD_MASK,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    if (!res.ok) return null;
    const place = (await res.json()) as GooglePlace;
    // 閉店確定の場所は目的地として扱わない(既存の「見つかりません」フローに委ねる)。
    if (place.businessStatus === "CLOSED_PERMANENTLY") return null;
    return this.toDestination(place);
  }

  private async toDestination(place: GooglePlace): Promise<Destination> {
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    const nearestStations =
      latitude != null && longitude != null
        ? await this.stationProvider.nearestStations(latitude, longitude, 1)
        : [];

    return {
      destinationId: place.id,
      name: place.displayName?.text ?? "",
      category: "facility",
      address: place.formattedAddress ?? "",
      latitude: latitude ?? 0,
      longitude: longitude ?? 0,
      nearestStationCandidates: nearestStations.map((s) => s.stationId),
      // フィールドマスクで明示的に要求しているため、値が無ければ「確認したが無い」
      // ことを意味する null にする(未確認を表す undefined とは区別する)。
      websiteUri: place.websiteUri ?? null,
      businessStatus: toDestinationBusinessStatus(place.businessStatus),
    };
  }
}
