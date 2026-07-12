import type { StationProviderPort } from "./StationProviderPort";
import {
  FIXTURE_BOARDING_POSITIONS,
  FIXTURE_FACILITIES,
  FIXTURE_PLATFORMS,
  FIXTURE_STATIONS,
} from "@/lib/fixtures/stations";

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

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const EARTH_RADIUS_METERS = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
