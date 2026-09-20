import type { FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import type { Coordinates } from "@/lib/domain/station";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import { lookupCatalogStation, catalogStationNameFrom } from "@/lib/data/station-facility-catalog";
import { resolveFacilityFromCatalog } from "@/lib/services/catalog-facility-resolver";
import {
  fetchOsmSubwayEntrances,
  mergeOsmExitsIntoCatalog,
} from "@/lib/integrations/osm/osm-subway-entrances";
import { generateSplitFacilityPair } from "@/lib/integrations/ai/split-facility-generation";

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

function fromSplitNames(gate: NamedFacility | null, exit: NamedFacility | null): FacilityRecommendation {
  if (gate && exit) {
    return {
      state: "confirmed",
      pair: { gate, exit, reason: "改札・出口を別検索して組み合わせた" },
    };
  }
  if (gate || exit) {
    return {
      state: "confirmed",
      pair: { gate, exit, reason: "分割生成で片方のみ確認" },
    };
  }
  return unavailable("分割生成でも改札・出口を確認できませんでした");
}

/**
 * 収録がある駅: 収録 → OSM → 分割生成 → 単一呼び出し。
 * 収録が無い駅: 既存の単一呼び出しのみ(全国駅で OSM/分割を足すとタイムアウトが増える)。
 * 両方揃った収録結果では Gemini .final を待たない。
 */
export async function resolveArrivalFacility(
  input: ArrivalFacilityResolveInput
): Promise<ArrivalFacilityResolveResult> {
  const catalogKey = catalogStationNameFrom({
    stationName: input.stationName,
    stationId: input.stationId,
  });
  const catalogRow = lookupCatalogStation(catalogKey);

  if (!catalogRow) {
    const last = await input.lastResortFacility();
    return {
      recommendation: last ?? unavailable("改札・出口の情報が確認できませんでした"),
      usedGeminiFinal: true,
    };
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
    const merged = mergeOsmExitsIntoCatalog([...catalogRow.facilities], osmExits);
    const osmResolved = resolveFacilityFromCatalog({
      stationName: input.stationName,
      stationId: input.stationId,
      stationCoordinates: input.stationCoordinates ?? center,
      destinationCoordinates: input.destinationCoordinates,
      facilities: merged,
    });
    if (isScoringBothHit(osmResolved.recommendation)) {
      return { recommendation: osmResolved.recommendation, usedGeminiFinal: false };
    }
  }

  if (input.geminiApiKey.trim().length > 0) {
    const split = await generateSplitFacilityPair({
      apiKey: input.geminiApiKey,
      stationName: input.stationName,
      stationCoordinates: input.stationCoordinates,
      destinationHint: input.destinationHint,
    });
    const splitRec = fromSplitNames(split.gate, split.exit);
    if (isScoringBothHit(splitRec)) {
      return { recommendation: splitRec, usedGeminiFinal: false };
    }
  }

  const last = await input.lastResortFacility();
  if (last) {
    return { recommendation: last, usedGeminiFinal: true };
  }
  return {
    recommendation:
      catalogResult.recommendation.state === "unavailable"
        ? unavailable("改札・出口の情報が確認できませんでした")
        : catalogResult.recommendation,
    usedGeminiFinal: true,
  };
}
