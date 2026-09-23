import type { FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { haversineMeters } from "@/lib/geo/haversine";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import { resolveExitRecommendation } from "@/lib/services/facility-coordinate-selection";

/** 到着駅中心からこれより遠い地図出口は当該駅の出口として扱わない(隣駅入口の混入防止)。 */
export const MAX_MAP_EXIT_DISTANCE_FROM_CENTER_M = 250;

function toNamed(facility: StationFacility): NamedFacility {
  return {
    name: facility.name,
    confidence: facility.confidence,
    provenance: facility.provenance ?? "surveyed",
    coordinates: facility.coordinates,
  };
}

export function filterFacilitiesNearStationCenter(
  facilities: readonly StationFacility[],
  stationCenter: Coordinates
): StationFacility[] {
  return facilities.filter((facility) => {
    if (facility.facilityType !== "exit") return true;
    if (!facility.coordinates) return false;
    return (
      haversineMeters(
        stationCenter.lat,
        stationCenter.lng,
        facility.coordinates.lat,
        facility.coordinates.lng
      ) <= MAX_MAP_EXIT_DISTANCE_FROM_CENTER_M
    );
  });
}

/**
 * 改札名は既に確定しているが出口だけ欠けているとき、座標付きの公的地図データ
 * (収録 / OSM) から方角一致する出口を1件選び BothHit にする。AI だけの出口名は使わない。
 */
export function pairConfirmedGateWithMapExit(
  gate: NamedFacility,
  facilities: readonly StationFacility[],
  destinationCoordinates: Coordinates,
  stationCenter: Coordinates
): FacilityRecommendation | null {
  const scoped = filterFacilitiesNearStationCenter(facilities, stationCenter);
  const exitRec = resolveExitRecommendation(scoped, destinationCoordinates, stationCenter);
  if (exitRec.tier !== "exact" || exitRec.exit === null) return null;

  const provenance = exitRec.exit.provenance ?? "ai_inferred";
  if (provenance !== "map_estimate" && provenance !== "surveyed") return null;

  const recommendation: FacilityRecommendation = {
    state: "confirmed",
    pair: {
      gate,
      exit: toNamed(exitRec.exit),
      reason: "改札は案内確定、出口は公的地図データで目的地方角と一致",
    },
  };
  return isScoringBothHit(recommendation) ? recommendation : null;
}

export function countKnownSeparateExits(
  facilities: readonly StationFacility[],
  stationCenter: Coordinates | null
): number | null {
  const scoped =
    stationCenter === null ? facilities : filterFacilitiesNearStationCenter(facilities, stationCenter);
  const count = scoped.filter((f) => f.facilityType === "exit").length;
  return count > 0 ? count : null;
}
