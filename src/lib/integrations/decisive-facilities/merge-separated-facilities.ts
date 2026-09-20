import type { Coordinates } from "@/lib/domain/station";
import type { FacilityPair } from "@/lib/domain/facility-recommendation";
import type { RawFacilityPair, RawNamedFacility } from "@/lib/integrations/ai/single-call-navigator";
import { loadDecisiveFacilities } from "./catalog";
import { resolveExitAndGateFromFacilities } from "./exit-resolution";

export interface SeparatedFacilityCandidates {
  gateCandidates: RawNamedFacility[];
  exitCandidates: RawNamedFacility[];
  legacyPairs: RawFacilityPair[];
}

export interface DecisiveMergeContext {
  stationId: string;
  arrivalStationName: string;
  arrivalStationCoordinates: Coordinates | null;
  destinationCoordinates: Coordinates | null;
}

function firstCandidate(candidates: RawNamedFacility[]): RawNamedFacility | null {
  return candidates.length > 0 ? candidates[0] : null;
}

function facilityFromDecisive(name: string, confidenceLevel: "high" | "medium" | "low"): RawNamedFacility {
  return { name, confidenceLevel };
}

/**
 * 改札・出口の生成分離: 決定的データ(OSM/fixture)で出口→改札を先に確定し、
 * 不足分のみ AI 単独候補から補完。legacy の facilityCandidates ペアは最後のフォールバック。
 */
export async function mergeSeparatedFacilityPair(
  separated: SeparatedFacilityCandidates,
  context: DecisiveMergeContext
): Promise<RawFacilityPair | null> {
  const stationCenter = context.arrivalStationCoordinates;
  const decisiveFacilities = await loadDecisiveFacilities(
    context.stationId,
    context.arrivalStationName,
    stationCenter
  );

  if (decisiveFacilities.length > 0 && context.destinationCoordinates && stationCenter) {
    const resolved = resolveExitAndGateFromFacilities(
      decisiveFacilities,
      context.destinationCoordinates,
      stationCenter
    );
    if (resolved.tier === "exact" && resolved.exit && resolved.gate) {
      return {
        gate: facilityFromDecisive(resolved.gate.name, "high"),
        exit: facilityFromDecisive(resolved.exit.name, "high"),
        reason: "決定的データ(fixture/OSM)による出口・改札の分離確定",
      };
    }
  }

  const aiGate = firstCandidate(separated.gateCandidates);
  const aiExit = firstCandidate(separated.exitCandidates);
  if (aiGate && aiExit) {
    return { gate: aiGate, exit: aiExit, reason: "改札・出口の分離抽出(AI)" };
  }

  const legacyComplete = separated.legacyPairs.filter((p) => p.gate && p.exit);
  if (legacyComplete.length === 1) return legacyComplete[0];

  return null;
}

/**
 * BothHit 必須: gate と exit が揃った pair のみ confirmed にする。
 */
export function classifyBothRequiredPair(
  pair: RawFacilityPair | null
): FacilityPair<RawNamedFacility> | null {
  if (!pair || !pair.gate || !pair.exit) return null;
  return pair;
}
