import {
  classifyFacilityRecommendation,
  type FacilityPair,
  type FacilityRecommendation,
} from "@/lib/domain/facility-recommendation";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import {
  evaluateFacilityJudgment,
  type JevClientConfig,
  type JevFacilityJudgmentDecision,
} from "@/lib/integrations/ai/JevClient";
import type { RawNamedFacility } from "@/lib/integrations/ai/single-call-navigator";

export interface JudgmentSnapshot<F extends { name: string } = RawNamedFacility> {
  destinationHint: string | null;
  arrivalStationName: string;
  searchText: string;
  geminiPairs: FacilityPair<F>[];
  catalogPair: FacilityPair<F> | null;
  osmExitNames: readonly string[];
}

export interface JudgmentOutcome<F extends { name: string } = RawNamedFacility> {
  recommendation: FacilityRecommendation<F>;
  bothHit: boolean;
  shouldRetry: boolean;
  skipGeminiFacility: boolean;
}

const optionalCatalogPairs = new Map<string, FacilityPair<RawNamedFacility>>();

export function loadOptionalCatalogPair(stationName: string): FacilityPair<RawNamedFacility> | null {
  return optionalCatalogPairs.get(stationName) ?? null;
}

function catalogHasBoth<F extends { name: string }>(
  pair: FacilityPair<F> | null
): pair is FacilityPair<F> & { gate: F; exit: F } {
  return pair !== null && pair.gate !== null && pair.exit !== null;
}

function finish<F extends { name: string }>(
  recommendation: FacilityRecommendation<F>,
  skipGeminiFacility: boolean
): JudgmentOutcome<F> {
  const bothHit = isScoringBothHit(recommendation);
  return {
    recommendation,
    bothHit,
    shouldRetry: !bothHit,
    skipGeminiFacility: skipGeminiFacility && bothHit,
  };
}

function pairHasBoth<F extends { name: string }>(pair: FacilityPair<F>): boolean {
  return pair.gate !== null && pair.exit !== null;
}

function pickGeminiRecommendation<F extends { name: string }>(
  pairs: FacilityPair<F>[],
  candidateScores: number[] | undefined
): FacilityRecommendation<F> {
  const classified = classifyFacilityRecommendation(pairs);
  if (classified.state !== "alternatives") {
    return classified;
  }
  if (!candidateScores || candidateScores.length !== classified.pairs.length) {
    return classified;
  }
  if (candidateScores.every((score) => score <= 0)) {
    return classified;
  }

  const bothHitIndices = classified.pairs
    .map((pair, index) => (pairHasBoth(pair) ? index : -1))
    .filter((index) => index >= 0);
  const rankable = bothHitIndices.length > 0 ? bothHitIndices : classified.pairs.map((_, index) => index);

  let selectedIndex = rankable[0];
  for (const index of rankable) {
    if (candidateScores[index] > candidateScores[selectedIndex]) {
      selectedIndex = index;
    }
  }
  const selected = classified.pairs[selectedIndex];
  if (!selected) {
    return classified;
  }
  return { state: "confirmed", pair: selected };
}

function adoptCatalog<F extends { name: string }>(
  catalogPair: FacilityPair<F> & { gate: F; exit: F }
): JudgmentOutcome<F> {
  return finish({ state: "confirmed", pair: catalogPair }, true);
}

export async function runFacilityJudgmentPipeline<F extends { name: string }>(
  snapshot: JudgmentSnapshot<F>,
  config: JevClientConfig | null
): Promise<JudgmentOutcome<F>> {
  const catalogPair = catalogHasBoth(snapshot.catalogPair) ? snapshot.catalogPair : null;
  const needsJevRank = snapshot.geminiPairs.length >= 2;
  const needsJevCatalog = catalogPair !== null;

  if (config === null || (!needsJevRank && !needsJevCatalog)) {
    if (catalogPair) {
      return adoptCatalog(catalogPair);
    }
    return finish(classifyFacilityRecommendation(snapshot.geminiPairs), false);
  }

  let judgment: JevFacilityJudgmentDecision;
  try {
    judgment = await evaluateFacilityJudgment(
      {
        destinationHint: snapshot.destinationHint,
        arrivalStationName: snapshot.arrivalStationName,
        searchText: snapshot.searchText,
        catalogPair: snapshot.catalogPair,
        geminiPairs: snapshot.geminiPairs,
        osmExitNames: snapshot.osmExitNames,
      },
      config
    );
  } catch {
    if (catalogPair) {
      return adoptCatalog(catalogPair);
    }
    return finish(classifyFacilityRecommendation(snapshot.geminiPairs), false);
  }

  if (catalogPair && (judgment.skipGeminiFacility || judgment.adoptCatalog)) {
    return adoptCatalog(catalogPair);
  }

  const geminiRecommendation = pickGeminiRecommendation(
    snapshot.geminiPairs,
    judgment.candidateScores
  );
  if (isScoringBothHit(geminiRecommendation)) {
    return finish(geminiRecommendation, false);
  }
  if (catalogPair) {
    return adoptCatalog(catalogPair);
  }
  return finish(geminiRecommendation, false);
}
