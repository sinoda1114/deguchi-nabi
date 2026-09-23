import type { FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import type { Coordinates } from "@/lib/domain/station";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import {
  generateExitOnly,
  generateGateOnly,
  generateSplitFacilityPair,
} from "@/lib/integrations/ai/split-facility-generation";

export interface FacilityEnrichmentInput {
  geminiApiKey: string;
  stationName: string;
  stationCoordinates: Coordinates | null;
  destinationHint: string | null;
  destinationCoordinates: Coordinates | null;
}

function splitGenInput(input: FacilityEnrichmentInput) {
  return {
    apiKey: input.geminiApiKey,
    stationName: input.stationName,
    stationCoordinates: input.stationCoordinates,
    destinationHint: input.destinationHint,
  };
}

function confirmedPair(gate: NamedFacility, exit: NamedFacility, reason: string): FacilityRecommendation {
  return {
    state: "confirmed",
    pair: { gate, exit, reason },
  };
}

/** 接続名が無いときは確定済み改札/出口を維持。明示的に別名のときだけ拒否。 */
function pairedNameMatches(fixedName: string, pairedName: string | null): boolean {
  if (!pairedName) return true;
  return pairedName === fixedName;
}

/**
 * 単一呼び出し等で改札・出口の片方だけ確定したとき、分割検索で接続が交差検証できる
 * もう片方を補う。確定済みの片側を別ペアの AI 結果で置き換えない。
 */
export async function enrichPartialFacilityPair(
  input: FacilityEnrichmentInput,
  recommendation: FacilityRecommendation
): Promise<FacilityRecommendation> {
  if (isScoringBothHit(recommendation)) return recommendation;
  if (!input.destinationCoordinates || input.geminiApiKey.trim().length === 0) {
    return recommendation;
  }

  if (recommendation.state !== "confirmed") {
    return recommendation;
  }

  const splitInput = splitGenInput(input);
  const { gate, exit } = recommendation.pair;

  if (gate && !exit) {
    const exitSearch = await generateExitOnly(splitInput);
    if (exitSearch.exit && pairedNameMatches(gate.name, exitSearch.pairedGateName)) {
      return confirmedPair(
        gate,
        exitSearch.exit,
        "改札確定後に接続改札が一致する出口を別検索で補完"
      );
    }
    const split = await generateSplitFacilityPair(splitInput);
    if (split.paired && split.gate?.name === gate.name && split.exit) {
      return confirmedPair(gate, split.exit, "確定改札と接続が一致する出口を分割生成で補完");
    }
    return recommendation;
  }

  if (exit && !gate) {
    const gateSearch = await generateGateOnly(splitInput);
    if (gateSearch.gate && pairedNameMatches(exit.name, gateSearch.pairedExitName)) {
      return confirmedPair(
        gateSearch.gate,
        exit,
        "出口確定後に接続出口が一致する改札を別検索で補完"
      );
    }
    const split = await generateSplitFacilityPair(splitInput);
    if (split.paired && split.exit?.name === exit.name && split.gate) {
      return confirmedPair(split.gate, exit, "確定出口と接続が一致する改札を分割生成で補完");
    }
    return recommendation;
  }

  return recommendation;
}
