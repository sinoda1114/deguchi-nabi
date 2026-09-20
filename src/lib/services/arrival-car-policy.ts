import type { FacilityRecommendation, UniqueChosenGate } from "@/lib/domain/facility-recommendation";
import { uniqueChosenGateOf } from "@/lib/domain/facility-recommendation";
import type { BoardingPosition, Station } from "@/lib/domain/station";
import type { Confidence } from "@/lib/domain/confidence";
import type { RailSegmentCandidate } from "@/lib/integrations/route-provider/RouteProviderPort";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";

export interface UnifiedBoardingPosition {
  carNumber: number;
  doorPosition: string;
  reason: string;
  confidence: Confidence;
}

/**
 * 到着区間の号車政策。排他的。unified / omit / gate の直積は表現しない。
 */
export type ArrivalCarPolicy =
  | { type: "unified"; position: UnifiedBoardingPosition }
  | { type: "forGate"; gate: UniqueChosenGate }
  | { type: "independent" }
  | { type: "none" };

export function arrivalCarPolicyFrom(result: {
  unifiedBoardingPosition: UnifiedBoardingPosition | null;
  omitIndependentBoarding: boolean;
  facilityRecommendation: FacilityRecommendation;
}): ArrivalCarPolicy {
  if (result.unifiedBoardingPosition) {
    return { type: "unified", position: result.unifiedBoardingPosition };
  }
  if (result.omitIndependentBoarding) {
    const gate = uniqueChosenGateOf(result.facilityRecommendation);
    return gate ? { type: "forGate", gate } : { type: "none" };
  }
  return { type: "independent" };
}

/**
 * 到着区間の号車だけを政策に従って取る。非到着区間では呼ばない。
 * forGate で無条件 getBoardingPosition へ落ちない。
 */
export async function resolveArrivalSegmentBoarding(
  policy: ArrivalCarPolicy,
  stationProvider: StationProviderPort,
  fromStation: Station | null,
  toStation: Station | null,
  rail: RailSegmentCandidate
): Promise<UnifiedBoardingPosition | BoardingPosition | null> {
  if (policy.type === "unified") return policy.position;
  if (policy.type === "none" || !fromStation) return null;
  if (policy.type === "forGate") {
    if (!stationProvider.getBoardingForChosenGate) return null;
    return stationProvider.getBoardingForChosenGate(
      {
        fromStationId: rail.fromStationId,
        fromStationName: fromStation.stationName,
        arrivalStationName: toStation?.stationName ?? rail.toStationId,
        platformId: rail.platformId,
        line: rail.line,
        direction: rail.direction,
      },
      policy.gate
    );
  }
  return stationProvider.getBoardingPosition(
    rail.fromStationId,
    fromStation.stationName,
    rail.platformId,
    rail.line,
    rail.direction
  );
}
