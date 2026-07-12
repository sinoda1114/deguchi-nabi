import type { AccessibilityCondition, RouteGuide, RouteMode } from "@/lib/domain/route";
import type { User } from "@/lib/domain/user";
import { routeProvider, stationProvider, placeProvider } from "@/lib/integrations";
import { searchRouteGuide } from "./route-search";

export type OriginRequest =
  | { type: "home_station" }
  | { type: "station"; stationId: string };

export type DestinationRequest =
  | { type: "station"; stationId: string }
  | { type: "place"; placeId: string };

export interface RouteSearchOrchestratorInput {
  origin: OriginRequest;
  destination: DestinationRequest;
  mode: RouteMode;
  accessibility?: Partial<AccessibilityCondition>;
}

export type ResolvedRouteSearch =
  | {
      ok: true;
      route: RouteGuide;
      originStationId: string;
      originLabel: string;
      destinationStationId: string;
      destinationLabel: string;
    }
  | { ok: false; status: number; error: string };

export async function resolveAndSearchRoute(
  input: RouteSearchOrchestratorInput,
  sessionUser: User | null
): Promise<ResolvedRouteSearch> {
  let originStationId: string | null = null;

  if (input.origin.type === "home_station") {
    if (!sessionUser?.homeStationId) {
      return { ok: false, status: 400, error: "最寄り駅が登録されていません" };
    }
    originStationId = sessionUser.homeStationId;
  } else {
    originStationId = input.origin.stationId;
  }

  const originStation = await stationProvider.getStation(originStationId);
  const originLabel = originStation?.stationName ?? originStationId;

  let destinationStationId: string | null = null;
  let destinationLabel = "";

  if (input.destination.type === "station") {
    const stationId = input.destination.stationId;
    const station = await stationProvider.getStation(stationId);
    if (!station) {
      return { ok: false, status: 404, error: "目的地の駅が見つかりません" };
    }
    destinationStationId = stationId;
    destinationLabel = station.stationName;
  } else {
    const place = await placeProvider.getPlace(input.destination.placeId);
    if (!place) {
      return { ok: false, status: 404, error: "目的地が見つかりません" };
    }
    destinationStationId = place.nearestStationCandidates[0] ?? null;
    destinationLabel = place.name;
  }

  if (!destinationStationId) {
    return { ok: false, status: 400, error: "目的地の最寄り駅を特定できません" };
  }

  const accessibility: AccessibilityCondition = {
    avoidStairs: input.accessibility?.avoidStairs ?? false,
    preferElevator: input.accessibility?.preferElevator ?? false,
    preferEscalator: input.accessibility?.preferEscalator ?? false,
  };

  const result = await searchRouteGuide(
    {
      originStationId,
      originLabel,
      destinationStationId,
      destinationLabel,
      mode: input.mode,
      accessibility,
    },
    { routeProvider, stationProvider }
  );

  if (!result.ok) {
    return { ok: false, status: 422, error: result.reason };
  }

  return {
    ok: true,
    route: result.route,
    originStationId,
    originLabel,
    destinationStationId,
    destinationLabel,
  };
}
