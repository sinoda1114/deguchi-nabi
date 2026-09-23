import type { FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import {
  generateExitOnly,
  generateGateOnly,
  generateSplitFacilityPair,
} from "@/lib/integrations/ai/split-facility-generation";
import type { ArrivalFacilityResolveInput } from "@/lib/services/arrival-facility-resolver";

function splitGenInput(input: ArrivalFacilityResolveInput) {
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

/**
 * 単一呼び出し等で改札・出口の片方だけ確定したとき、分割検索で接続が交差検証できる
 * もう片方を補う。両方揃っている、または API キー・目的地座標が無いときはそのまま返す。
 */
export async function enrichPartialFacilityPair(
  input: ArrivalFacilityResolveInput,
  recommendation: FacilityRecommendation
): Promise<FacilityRecommendation> {
  if (isScoringBothHit(recommendation)) return recommendation;
  if (!input.destinationCoordinates || input.geminiApiKey.trim().length === 0) {
    return recommendation;
  }

  const splitInput = splitGenInput(input);

  if (recommendation.state !== "confirmed") {
    const split = await generateSplitFacilityPair(splitInput);
    if (split.paired && split.gate && split.exit) {
      return confirmedPair(split.gate, split.exit, "改札・出口を別検索し、接続名が一致した組");
    }
    return recommendation;
  }

  const { gate, exit } = recommendation.pair;

  if (gate && !exit) {
    const exitSearch = await generateExitOnly(splitInput);
    if (exitSearch.exit && exitSearch.pairedGateName === gate.name) {
      return confirmedPair(
        gate,
        exitSearch.exit,
        "改札確定後に接続改札が一致する出口を別検索で補完"
      );
    }
    const split = await generateSplitFacilityPair(splitInput);
    if (split.paired && split.gate?.name === gate.name && split.exit) {
      return confirmedPair(
        gate,
        split.exit,
        "確定改札と接続が一致する出口を分割生成で補完"
      );
    }
  }

  if (exit && !gate) {
    const gateSearch = await generateGateOnly(splitInput);
    if (gateSearch.gate && gateSearch.pairedExitName === exit.name) {
      return confirmedPair(
        gateSearch.gate,
        exit,
        "出口確定後に接続出口が一致する改札を別検索で補完"
      );
    }
    const split = await generateSplitFacilityPair(splitInput);
    if (split.paired && split.exit?.name === exit.name && split.gate) {
      return confirmedPair(
        split.gate,
        exit,
        "確定出口と接続が一致する改札を分割生成で補完"
      );
    }
  }

  const split = await generateSplitFacilityPair(splitInput);
  if (split.paired && split.gate && split.exit) {
    return confirmedPair(split.gate, split.exit, "改札・出口を別検索し、接続名が一致した組");
  }

  return recommendation;
}
