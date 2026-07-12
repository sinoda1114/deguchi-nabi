import type { Destination, Station } from "@/lib/domain/station";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import type { PlaceProviderPort } from "@/lib/integrations/place-provider/PlaceProviderPort";

export type SearchCandidate =
  | { kind: "station"; station: Station }
  | { kind: "place"; destination: Destination };

export interface PlaceResolutionDeps {
  stationProvider: StationProviderPort;
  placeProvider: PlaceProviderPort;
}

export async function searchDestinationCandidates(
  query: string,
  deps: PlaceResolutionDeps
): Promise<SearchCandidate[]> {
  const [stations, places] = await Promise.all([
    deps.stationProvider.searchStations(query),
    deps.placeProvider.searchPlaces(query),
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
