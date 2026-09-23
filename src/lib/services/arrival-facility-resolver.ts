import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";
import type { Coordinates } from "@/lib/domain/station";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import { lookupCatalogStation, catalogStationNameFrom } from "@/lib/data/station-facility-catalog";
import { resolveFacilityFromCatalog } from "@/lib/services/catalog-facility-resolver";
import {
  fetchOsmSubwayEntrances,
  mergeOsmExitsIntoCatalog,
} from "@/lib/integrations/osm/osm-subway-entrances";
import { generateSplitFacilityPair } from "@/lib/integrations/ai/split-facility-generation";
import { enrichPartialFacilityPair } from "@/lib/services/arrival-facility-enrichment";

export interface ArrivalFacilityResolveInput {
  stationId: string;
  stationName: string;
  stationCoordinates: Coordinates | null;
  destinationHint: string | null;
  destinationCoordinates: Coordinates | null;
  geminiApiKey: string;
  lastResortFacility: () => Promise<FacilityRecommendation | null>;
}

export interface ArrivalFacilityResolveResult {
  recommendation: FacilityRecommendation;
  usedGeminiFinal: boolean;
}

function unavailable(reason: string): FacilityRecommendation {
  return { state: "unavailable", reason };
}

async function lastResortWithEnrichment(
  input: ArrivalFacilityResolveInput,
  last: FacilityRecommendation | null
): Promise<ArrivalFacilityResolveResult> {
  const base = last ?? unavailable("改札・出口の情報が確認できませんでした");
  const recommendation = await enrichPartialFacilityPair(input, base);
  return { recommendation, usedGeminiFinal: true };
}

/**
 * 収録がある駅 + 目的地座標: 収録 → OSM → 交差検証できた分割生成 → 単一呼び出し。
 * 目的地座標が無い、または収録の無い駅: 既存の単一呼び出しのみ。
 */
export async function resolveArrivalFacility(
  input: ArrivalFacilityResolveInput
): Promise<ArrivalFacilityResolveResult> {
  const catalogKey = catalogStationNameFrom({
    stationName: input.stationName,
    stationId: input.stationId,
  });
  const catalogRow = lookupCatalogStation(catalogKey);

  if (!catalogRow || !input.destinationCoordinates) {
    return lastResortWithEnrichment(input, await input.lastResortFacility());
  }

  const catalogResult = resolveFacilityFromCatalog({
    stationName: input.stationName,
    stationId: input.stationId,
    stationCoordinates: input.stationCoordinates,
    destinationCoordinates: input.destinationCoordinates,
    facilities: catalogRow.facilities,
  });

  if (isScoringBothHit(catalogResult.recommendation)) {
    return { recommendation: catalogResult.recommendation, usedGeminiFinal: false };
  }

  const center = input.stationCoordinates ?? catalogRow.stationCenter;
  const osmExits = await fetchOsmSubwayEntrances(center);
  if (osmExits.length > 0) {
    const osmResolved = resolveFacilityFromCatalog({
      stationName: input.stationName,
      stationId: input.stationId,
      stationCoordinates: input.stationCoordinates ?? center,
      destinationCoordinates: input.destinationCoordinates,
      facilities: mergeOsmExitsIntoCatalog([...catalogRow.facilities], osmExits),
    });
    if (isScoringBothHit(osmResolved.recommendation)) {
      return { recommendation: osmResolved.recommendation, usedGeminiFinal: false };
    }
  }

  let splitPartial: FacilityRecommendation | null = null;
  if (input.geminiApiKey.trim().length > 0) {
    const split = await generateSplitFacilityPair({
      apiKey: input.geminiApiKey,
      stationName: input.stationName,
      stationCoordinates: input.stationCoordinates,
      destinationHint: input.destinationHint,
    });
    if (split.paired && split.gate && split.exit) {
      return {
        recommendation: {
          state: "confirmed",
          pair: {
            gate: split.gate,
            exit: split.exit,
            reason: "改札・出口を別検索し、接続名が一致した組",
          },
        },
        usedGeminiFinal: false,
      };
    }
    const onlyGate = split.gate && !split.exit;
    const onlyExit = split.exit && !split.gate;
    if (onlyGate || onlyExit) {
      splitPartial = {
        state: "confirmed",
        pair: {
          gate: onlyGate ? split.gate : null,
          exit: onlyExit ? split.exit : null,
          reason: "分割生成で片方のみ確認",
        },
      };
    }
  }

  const last = await input.lastResortFacility();
  if (last && isScoringBothHit(last)) {
    return { recommendation: last, usedGeminiFinal: true };
  }

  let candidate: FacilityRecommendation = unavailable("改札・出口の情報が確認できませんでした");
  if (last?.state === "confirmed" && (last.pair.gate || last.pair.exit)) {
    candidate = last;
  } else if (splitPartial) {
    candidate = splitPartial;
  } else if (
    catalogResult.recommendation.state === "confirmed" &&
    (catalogResult.recommendation.pair.gate || catalogResult.recommendation.pair.exit)
  ) {
    candidate = catalogResult.recommendation;
  } else if (last) {
    candidate = last;
  }

  const enriched = await enrichPartialFacilityPair(input, candidate);
  if (isScoringBothHit(enriched)) {
    const fromSplitOnly =
      splitPartial !== null &&
      candidate === splitPartial &&
      !(last?.state === "confirmed" && (last.pair.gate || last.pair.exit));
    return { recommendation: enriched, usedGeminiFinal: !fromSplitOnly };
  }

  return { recommendation: enriched, usedGeminiFinal: true };
}
