import type { AccessibilityCondition, RouteGuide, RouteMode } from "@/lib/domain/route";
import type { User } from "@/lib/domain/user";
import type { PlaceProviderPort } from "@/lib/integrations/place-provider/PlaceProviderPort";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import { routeProvider, stationProvider, placeProvider } from "@/lib/integrations";
import { searchRouteGuide, type Coordinates } from "./route-search";

export type OriginRequest =
  | { type: "home_station" }
  | { type: "station"; stationId: string };

export type DestinationRequest =
  | { type: "station"; stationId: string }
  | { type: "place"; placeId: string };

export interface OriginDestinationRequest {
  origin: OriginRequest;
  destination: DestinationRequest;
}

export interface OriginDestinationDeps {
  stationProvider: StationProviderPort;
  placeProvider: PlaceProviderPort;
}

export type ResolvedOriginDestination =
  | {
      ok: true;
      originStationId: string;
      originLabel: string;
      destinationStationId: string;
      destinationLabel: string;
      /**
       * 目的地座標(place由来のみ)。station由来(駅自体が目的地)は
       * 座標最適化が不要なため null。目的地に応じた出口選定
       * (docs/04_EXIT_SELECTION_DESIGN.md)に使う。
       */
      destinationCoordinates: Coordinates | null;
    }
  | { ok: false; status: number; error: string };

/**
 * origin/destination の入力(home_station/station/place)から stationId・表示ラベルを解決する。
 * resolveAndSearchRoute(POST API用ラッパー)と /routes/result の page.tsx の両方から
 * 直接呼び出せるよう、deps を注入可能にしている(page.tsx はストリーミング表示のため
 * この結果を先に確定させ、経路本体の解決は別途 resolveRouteCandidate 等に委ねる)。
 */
export async function resolveOriginDestination(
  input: OriginDestinationRequest,
  sessionUser: User | null,
  deps: OriginDestinationDeps
): Promise<ResolvedOriginDestination> {
  let originStationId: string | null = null;

  if (input.origin.type === "home_station") {
    if (!sessionUser?.homeStationId) {
      return { ok: false, status: 400, error: "最寄り駅が登録されていません" };
    }
    originStationId = sessionUser.homeStationId;
  } else {
    originStationId = input.origin.stationId;
  }

  const originStation = await deps.stationProvider.getStation(originStationId);
  const originLabel = originStation?.stationName ?? originStationId;

  let destinationStationId: string | null = null;
  let destinationLabel = "";
  let destinationCoordinates: Coordinates | null = null;

  if (input.destination.type === "station") {
    const stationId = input.destination.stationId;
    const station = await deps.stationProvider.getStation(stationId);
    if (!station) {
      return { ok: false, status: 404, error: "目的地の駅が見つかりません" };
    }
    destinationStationId = stationId;
    destinationLabel = station.stationName;
  } else {
    const place = await deps.placeProvider.getPlace(input.destination.placeId);
    if (!place) {
      return { ok: false, status: 404, error: "目的地が見つかりません" };
    }
    destinationStationId = place.nearestStationCandidates[0] ?? null;
    destinationLabel = place.name;
    destinationCoordinates = { lat: place.latitude, lng: place.longitude };
  }

  if (!destinationStationId) {
    return { ok: false, status: 400, error: "目的地の最寄り駅を特定できません" };
  }

  return {
    ok: true,
    originStationId,
    originLabel,
    destinationStationId,
    destinationLabel,
    destinationCoordinates,
  };
}

export interface RouteSearchOrchestratorInput extends OriginDestinationRequest {
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

/**
 * POST API(/api/routes/search)から利用されるラッパー。挙動は不変。
 * origin/destination の解決を resolveOriginDestination に委譲し、
 * その後 searchRouteGuide で経路全体を一括取得する。
 */
export async function resolveAndSearchRoute(
  input: RouteSearchOrchestratorInput,
  sessionUser: User | null
): Promise<ResolvedRouteSearch> {
  const resolved = await resolveOriginDestination(
    { origin: input.origin, destination: input.destination },
    sessionUser,
    { stationProvider, placeProvider }
  );

  if (!resolved.ok) {
    return resolved;
  }

  const accessibility: AccessibilityCondition = {
    avoidStairs: input.accessibility?.avoidStairs ?? false,
    preferElevator: input.accessibility?.preferElevator ?? false,
    preferEscalator: input.accessibility?.preferEscalator ?? false,
  };

  const result = await searchRouteGuide(
    {
      originStationId: resolved.originStationId,
      originLabel: resolved.originLabel,
      destinationStationId: resolved.destinationStationId,
      destinationLabel: resolved.destinationLabel,
      destinationCoordinates: resolved.destinationCoordinates,
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
    originStationId: resolved.originStationId,
    originLabel: resolved.originLabel,
    destinationStationId: resolved.destinationStationId,
    destinationLabel: resolved.destinationLabel,
  };
}
