import type { PlaceProviderPort } from "./PlaceProviderPort";
import { FIXTURE_DESTINATIONS } from "@/lib/fixtures/destinations";

export class FixturePlaceAdapter implements PlaceProviderPort {
  async searchPlaces(query: string) {
    const normalized = query.trim();
    if (!normalized) return [];
    return FIXTURE_DESTINATIONS.filter((d) => d.name.includes(normalized));
  }

  async getPlace(placeId: string) {
    return FIXTURE_DESTINATIONS.find((d) => d.destinationId === placeId) ?? null;
  }
}
