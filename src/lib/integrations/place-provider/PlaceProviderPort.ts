import type { Destination } from "@/lib/domain/station";

export interface PlaceProviderPort {
  searchPlaces(query: string): Promise<Destination[]>;
  getPlace(placeId: string): Promise<Destination | null>;
}
