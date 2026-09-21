import type { OriginChoice } from "@/components/search/origin-choice";
import type { Coordinates, Station } from "@/lib/domain/station";

function coordinatesFromStation(station: Station | null): Coordinates | null {
  if (!station) return null;
  return { lat: station.latitude, lng: station.longitude };
}

function stationCoordinatesOnChoice(
  origin: Extract<OriginChoice, { type: "station" }>
): Coordinates | null {
  const { latitude, longitude } = origin;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { lat: latitude, lng: longitude };
}

export function destinationSearchBiasCoordinates(
  origin: OriginChoice | null,
  known: { homeStation: Station | null; localDefaultStation: Station | null }
): Coordinates | null {
  if (!origin) return null;

  switch (origin.type) {
    case "home_station":
      return coordinatesFromStation(known.homeStation);
    case "station": {
      const fromChoice = stationCoordinatesOnChoice(origin);
      if (fromChoice) return fromChoice;
      if (known.homeStation?.stationId === origin.stationId) {
        return coordinatesFromStation(known.homeStation);
      }
      if (known.localDefaultStation?.stationId === origin.stationId) {
        return coordinatesFromStation(known.localDefaultStation);
      }
      return null;
    }
    default: {
      const _exhaustive: never = origin;
      return _exhaustive;
    }
  }
}
