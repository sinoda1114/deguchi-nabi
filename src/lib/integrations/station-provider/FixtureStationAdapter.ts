import type { StationProviderPort } from "./StationProviderPort";
import {
  FIXTURE_BOARDING_POSITIONS,
  FIXTURE_FACILITIES,
  FIXTURE_PLATFORMS,
  FIXTURE_STATIONS,
} from "@/lib/fixtures/stations";
import { haversineMeters } from "@/lib/geo/haversine";

export class FixtureStationAdapter implements StationProviderPort {
  async searchStations(query: string) {
    const normalized = query.trim();
    if (!normalized) return [];
    return FIXTURE_STATIONS.filter((station) =>
      station.stationName.includes(normalized)
    );
  }

  async getStation(stationId: string) {
    return FIXTURE_STATIONS.find((s) => s.stationId === stationId) ?? null;
  }

  async getPlatforms(stationId: string) {
    return FIXTURE_PLATFORMS.filter((p) => p.stationId === stationId);
  }

  async getFacilities(stationId: string) {
    return FIXTURE_FACILITIES.filter((f) => f.stationId === stationId);
  }

  async getBoardingPositions(platformId: string) {
    return FIXTURE_BOARDING_POSITIONS.filter(
      (b) => b.platformId === platformId
    );
  }

  async getBoardingPosition(
    _stationId: string,
    _stationName: string,
    platformId: string,
    _line: string,
    _direction: string
  ) {
    if (!platformId) return null;
    const positions = await this.getBoardingPositions(platformId);
    return positions[0] ?? null;
  }

  async nearestStations(latitude: number, longitude: number, limit: number) {
    return [...FIXTURE_STATIONS]
      .sort(
        (a, b) =>
          haversineMeters(latitude, longitude, a.latitude, a.longitude) -
          haversineMeters(latitude, longitude, b.latitude, b.longitude)
      )
      .slice(0, limit);
  }
}
