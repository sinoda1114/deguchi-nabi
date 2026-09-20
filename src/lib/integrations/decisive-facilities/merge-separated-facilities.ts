import type { Coordinates } from "@/lib/domain/station";
import type { FacilityPair } from "@/lib/domain/facility-recommendation";
import type { RawFacilityPair, RawNamedFacility } from "@/lib/integrations/ai/single-call-navigator";
import { pickGateForExit, resolveExitRecommendation } from "@/lib/services/route-search";
import { loadDecisiveFacilities } from "./catalog";

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

export type MergedFacilitySource = "decisive" | "legacy" | "ai_separated";

export interface MergedFacilityResult {
  pair: RawFacilityPair;
  source: MergedFacilitySource;
}

function facilityFromDecisive(
  name: string,
  confidenceLevel: "high" | "medium" | "low"
): RawNamedFacility {
  return { name, confidenceLevel };
}

/**
 * 改札・出口の生成分離: 決定的データ(OSM/fixture)を最優先し、
 * AI は legacy ペアまたは gate/exit が各1件のときのみマージ（推測ペアリング禁止）。
 */
export async function mergeSeparatedFacilityPair(
  separated: SeparatedFacilityCandidates,
  context: DecisiveMergeContext
): Promise<MergedFacilityResult | null> {
  const stationCenter = context.arrivalStationCoordinates;
  const decisiveFacilities = await loadDecisiveFacilities(
    context.stationId,
    context.arrivalStationName,
    stationCenter
  );

  if (decisiveFacilities.length > 0 && context.destinationCoordinates && stationCenter) {
    const resolved = resolveExitRecommendation(
      decisiveFacilities,
      context.destinationCoordinates,
      stationCenter
    );
    if (resolved.tier === "exact" && resolved.exit) {
      const gate = pickGateForExit(decisiveFacilities, resolved.exit);
      if (gate) {
        const confidence: "high" | "medium" =
          resolved.exit.provenance === "surveyed" ? "high" : "medium";
        return {
          source: "decisive",
          pair: {
            gate: facilityFromDecisive(gate.name, confidence),
            exit: facilityFromDecisive(resolved.exit.name, confidence),
            reason: "決定的データ(fixture/OSM)による出口・改札の分離確定",
          },
        };
      }
    }
  }

  const legacyComplete = separated.legacyPairs.filter((p) => p.gate && p.exit);
  if (legacyComplete.length === 1) {
    return { source: "legacy", pair: legacyComplete[0] };
  }

  if (
    separated.gateCandidates.length === 1 &&
    separated.exitCandidates.length === 1
  ) {
    const aiGate = separated.gateCandidates[0];
    const aiExit = separated.exitCandidates[0];
    return {
      source: "ai_separated",
      pair: { gate: aiGate, exit: aiExit, reason: "改札・出口の分離抽出(AI・各1件)" },
    };
  }

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
