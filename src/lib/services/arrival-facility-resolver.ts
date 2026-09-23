import type { FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import { lookupCatalogStation, catalogStationNameFrom } from "@/lib/data/station-facility-catalog";
import { resolveFacilityFromCatalog } from "@/lib/services/catalog-facility-resolver";
import {
  countKnownSeparateExits,
  pairConfirmedGateWithMapExit,
} from "@/lib/services/deterministic-gate-exit-pair";
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
  knownSeparateExitCount: number | null;
}

function unavailable(reason: string): FacilityRecommendation {
  return { state: "unavailable", reason };
}

function catalogResolveInput(
  input: ArrivalFacilityResolveInput,
  facilities: readonly StationFacility[],
  stationCoordinates: Coordinates | null
) {
  return {
    stationName: input.stationName,
    stationId: input.stationId,
    stationCoordinates,
    destinationCoordinates: input.destinationCoordinates,
    facilities: [...facilities],
  };
}

async function finalizeRecommendation(
  input: ArrivalFacilityResolveInput,
  recommendation: FacilityRecommendation,
  usedGeminiFinal: boolean,
  facilities: readonly StationFacility[],
  stationCenter: Coordinates | null,
  knownSeparateExitCount: number | null
): Promise<ArrivalFacilityResolveResult> {
  let resolved = recommendation;
  if (!isScoringBothHit(resolved)) {
    resolved = await enrichPartialFacilityPair(input, resolved);
  }
  if (
    stationCenter &&
    input.destinationCoordinates &&
    facilities.length > 0 &&
    !isScoringBothHit(resolved) &&
    resolved.state === "confirmed" &&
    resolved.pair.gate &&
    !resolved.pair.exit
  ) {
    const paired = pairConfirmedGateWithMapExit(
      resolved.pair.gate,
      facilities,
      input.destinationCoordinates,
      stationCenter
    );
    if (paired) resolved = paired;
  }
  return { recommendation: resolved, usedGeminiFinal, knownSeparateExitCount };
}

/**
 * 目的地座標がある到着駅: 収録(あれば) → OSM → 分割生成 → 単一呼び出し → 補完 → 地図出口ペア。
 * 収録の無い駅も同じ段階を踏む。
 */
export async function resolveArrivalFacility(
  input: ArrivalFacilityResolveInput
): Promise<ArrivalFacilityResolveResult> {
  const catalogRow = lookupCatalogStation(
    catalogStationNameFrom({
      stationName: input.stationName,
      stationId: input.stationId,
    })
  );

  if (!input.destinationCoordinates) {
    const last = await input.lastResortFacility();
    return finalizeRecommendation(
      input,
      last ?? unavailable("改札・出口の情報が確認できませんでした"),
      true,
      [],
      null,
      null
    );
  }

  const center = input.stationCoordinates ?? catalogRow?.stationCenter ?? null;
  let facilities: StationFacility[] = catalogRow ? [...catalogRow.facilities] : [];
  const resolveCoords = input.stationCoordinates ?? center;

  if (catalogRow && resolveCoords) {
    const catalogOnly = resolveFacilityFromCatalog(
      catalogResolveInput(input, catalogRow.facilities, resolveCoords)
    );
    if (isScoringBothHit(catalogOnly.recommendation)) {
      return {
        recommendation: catalogOnly.recommendation,
        usedGeminiFinal: false,
        knownSeparateExitCount: countKnownSeparateExits(catalogRow.facilities, center),
      };
    }
  }

  if (center) {
    const osmExits = await fetchOsmSubwayEntrances(center);
    if (osmExits.length > 0) {
      facilities = mergeOsmExitsIntoCatalog(facilities, osmExits);
    }
  }

  const knownSeparateExitCount = countKnownSeparateExits(facilities, center);

  let mergedResult: FacilityRecommendation | null = null;
  if (facilities.length > 0 && resolveCoords) {
    mergedResult = resolveFacilityFromCatalog(
      catalogResolveInput(input, facilities, resolveCoords)
    ).recommendation;
    if (isScoringBothHit(mergedResult)) {
      return {
        recommendation: mergedResult,
        usedGeminiFinal: false,
        knownSeparateExitCount,
      };
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
      return successSplit(split.gate, split.exit, knownSeparateExitCount);
    }
    if (split.gate && !split.exit) {
      splitPartial = {
        state: "confirmed",
        pair: { gate: split.gate, exit: null, reason: "分割生成で片方のみ確認" },
      };
    } else if (split.exit && !split.gate) {
      splitPartial = {
        state: "confirmed",
        pair: { gate: null, exit: split.exit, reason: "分割生成で片方のみ確認" },
      };
    }
  }

  const last = await input.lastResortFacility();
  if (last && isScoringBothHit(last)) {
    return { recommendation: last, usedGeminiFinal: true, knownSeparateExitCount };
  }

  const catalogPartial =
    catalogRow && resolveCoords
      ? resolveFacilityFromCatalog(catalogResolveInput(input, catalogRow.facilities, resolveCoords))
          .recommendation
      : null;

  let usedGeminiFinal = false;
  let seed: FacilityRecommendation;
  const mergedPartial = mergeFacilityPartials({
    last,
    splitPartial,
    catalogPartial,
    mergedResult,
  });
  if (mergedPartial && isScoringBothHit(mergedPartial)) {
    seed = mergedPartial;
    usedGeminiFinal = gateNameMatchesLast(last, mergedPartial);
  } else if (mergedPartial) {
    seed = mergedPartial;
    usedGeminiFinal = gateNameMatchesLast(last, mergedPartial);
  } else if (last) {
    seed = last;
    usedGeminiFinal = true;
  } else {
    seed = unavailable("改札・出口の情報が確認できませんでした");
    usedGeminiFinal = true;
  }

  return finalizeRecommendation(
    input,
    seed,
    usedGeminiFinal,
    facilities,
    center,
    knownSeparateExitCount
  );
}

function successSplit(
  gate: NonNullable<Awaited<ReturnType<typeof generateSplitFacilityPair>>["gate"]>,
  exit: NonNullable<Awaited<ReturnType<typeof generateSplitFacilityPair>>["exit"]>,
  knownSeparateExitCount: number | null
): ArrivalFacilityResolveResult {
  return {
    recommendation: {
      state: "confirmed",
      pair: {
        gate,
        exit,
        reason: "改札・出口を別検索し、接続名が一致した組",
      },
    },
    usedGeminiFinal: false,
    knownSeparateExitCount,
  };
}

function isConfirmed(rec: FacilityRecommendation | null): rec is FacilityRecommendation {
  return rec?.state === "confirmed";
}

function pickNamedFrom(
  candidates: FacilityRecommendation[],
  pick: (rec: Extract<FacilityRecommendation, { state: "confirmed" }>) => NamedFacility | null
): NamedFacility | null {
  for (const rec of candidates) {
    if (rec.state !== "confirmed") continue;
    const value = pick(rec);
    if (value) return value;
  }
  return null;
}

function gateNameMatchesLast(
  last: FacilityRecommendation | null,
  merged: FacilityRecommendation
): boolean {
  if (last?.state !== "confirmed" || merged.state !== "confirmed") return false;
  const lastGate = last.pair.gate?.name ?? null;
  const mergedGate = merged.pair.gate?.name ?? null;
  return lastGate !== null && lastGate === mergedGate;
}

/** 単一呼び出し・分割・収録・OSM の片方だけ確定を、改札/出口ごとに優先順位で合成する。 */
export function mergeFacilityPartials(input: {
  last: FacilityRecommendation | null;
  splitPartial: FacilityRecommendation | null;
  catalogPartial: FacilityRecommendation | null;
  mergedResult: FacilityRecommendation | null;
}): FacilityRecommendation | null {
  const { last, splitPartial, catalogPartial, mergedResult } = input;
  const gate = pickNamedFrom(
    [last, splitPartial, catalogPartial, mergedResult].filter(isConfirmed),
    (rec) => rec.pair.gate
  );
  const exit = pickNamedFrom(
    [mergedResult, splitPartial, last, catalogPartial].filter(isConfirmed),
    (rec) => rec.pair.exit
  );
  if (!gate && !exit) return null;
  return {
    state: "confirmed",
    pair: {
      gate,
      exit,
      reason: "複数ソースの片方確定を合成",
    },
  };
}
