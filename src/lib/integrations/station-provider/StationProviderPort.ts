import type {
  BoardingPosition,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";

export interface StationProviderPort {
  searchStations(query: string): Promise<Station[]>;
  getStation(stationId: string): Promise<Station | null>;
  getPlatforms(stationId: string): Promise<Platform[]>;
  getFacilities(stationId: string): Promise<StationFacility[]>;
  getBoardingPositions(platformId: string): Promise<BoardingPosition[]>;
  nearestStations(
    latitude: number,
    longitude: number,
    limit: number
  ): Promise<Station[]>;
}
