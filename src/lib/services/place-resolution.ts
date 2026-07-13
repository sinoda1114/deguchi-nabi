import type { Coordinates, Destination, Station } from "@/lib/domain/station";
import type { FavoriteDestination } from "@/lib/domain/user";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import type { PlaceProviderPort } from "@/lib/integrations/place-provider/PlaceProviderPort";

export type SearchCandidate =
  | { kind: "station"; station: Station }
  | { kind: "place"; destination: Destination };

export interface PlaceResolutionDeps {
  stationProvider: StationProviderPort;
  placeProvider: PlaceProviderPort;
}

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * クエリパラメータ由来の lat/lng 文字列(未指定は null)を座標に変換する。
 * `Number(null)` が `0` になる罠を避けるため、欠落・空文字は変換前に弾く。
 * 範囲外の値(緯度経度として無効)も位置バイアス無しとして扱う。
 */
export function parseCoordinatesParam(
  lat: string | null,
  lng: string | null
): Coordinates | null {
  if (!lat || !lng) return null;
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  if (parsedLat < MIN_LATITUDE || parsedLat > MAX_LATITUDE) return null;
  if (parsedLng < MIN_LONGITUDE || parsedLng > MAX_LONGITUDE) return null;
  return { lat: parsedLat, lng: parsedLng };
}

/**
 * near(出発地の座標)を渡すと、その付近を優先した目的地検索になる
 * (同名施設の遠方店舗を誤って候補上位に出さないため)。
 */
export async function searchDestinationCandidates(
  query: string,
  deps: PlaceResolutionDeps,
  near?: Coordinates | null
): Promise<SearchCandidate[]> {
  const [stations, places] = await Promise.all([
    deps.stationProvider.searchStations(query),
    deps.placeProvider.searchPlaces(query, near),
  ]);

  return [
    ...stations.map((station): SearchCandidate => ({ kind: "station", station })),
    ...places.map((destination): SearchCandidate => ({ kind: "place", destination })),
  ];
}

/** 目的地候補から経路探索の到着駅IDを決める(最寄り駅候補の先頭を採用)。 */
export function resolveArrivalStationId(candidate: SearchCandidate): string | null {
  if (candidate.kind === "station") return candidate.station.stationId;
  return candidate.destination.nearestStationCandidates[0] ?? null;
}

export function candidateLabel(candidate: SearchCandidate): string {
  return candidate.kind === "station"
    ? candidate.station.stationName
    : candidate.destination.name;
}

/**
 * よく使う目的地として登録する際の入力(採番・所有者・登録日時を除いた部分)。
 * `Omit<FavoriteDestination, ...>` は判別可能なユニオン型に対して分配されず
 * 各メンバー固有のフィールド(station/destination)が失われるため、
 * 同じ形の判別ユニオンとして明示的に定義する。
 */
export type FavoriteDestinationInput =
  | { kind: "station"; station: Station; label: string }
  | { kind: "place"; destination: Destination; label: string };

/** 検索候補(SearchCandidate)を目的地登録APIへ渡す入力形式に変換する。 */
export function toFavoriteDestinationInput(candidate: SearchCandidate): FavoriteDestinationInput {
  return candidate.kind === "station"
    ? { kind: "station", station: candidate.station, label: candidateLabel(candidate) }
    : { kind: "place", destination: candidate.destination, label: candidateLabel(candidate) };
}

/** 登録済みの目的地(FavoriteDestination)を検索フォームで扱う検索候補に変換する。 */
export function toSearchCandidate(favorite: FavoriteDestination): SearchCandidate {
  return favorite.kind === "station"
    ? { kind: "station", station: favorite.station }
    : { kind: "place", destination: favorite.destination };
}

/** 登録済みの目的地と検索候補が同じ駅/施設を指しているかを判定する(選択中ハイライト等に使う)。 */
export function isSameFavoriteTarget(
  favorite: FavoriteDestination,
  candidate: SearchCandidate
): boolean {
  if (favorite.kind === "station" && candidate.kind === "station") {
    return favorite.station.stationId === candidate.station.stationId;
  }
  if (favorite.kind === "place" && candidate.kind === "place") {
    return favorite.destination.destinationId === candidate.destination.destinationId;
  }
  return false;
}
