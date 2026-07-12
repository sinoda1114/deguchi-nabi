import type { Destination } from "@/lib/domain/station";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import type { PlaceProviderPort } from "./PlaceProviderPort";

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_URL = "https://places.googleapis.com/v1/places";
const SEARCH_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location";
const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location";
const REQUEST_TIMEOUT_MS = 5000;

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
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

  async searchPlaces(query: string): Promise<Destination[]> {
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
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return [];
    const data = (await res.json()) as { places?: GooglePlace[] };
    const places = data.places ?? [];

    return Promise.all(places.map((place) => this.toDestination(place)));
  }

  async getPlace(placeId: string): Promise<Destination | null> {
    if (!placeId.trim()) return null;

    const res = await fetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const place = (await res.json()) as GooglePlace;
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
    };
  }
}
