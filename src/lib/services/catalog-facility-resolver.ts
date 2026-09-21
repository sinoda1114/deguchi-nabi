import {
  uniqueChosenGateOf,
  type NamedFacility,
  type FacilityRecommendation,
} from "@/lib/domain/facility-recommendation";
import type { Coordinates, Station, StationFacility } from "@/lib/domain/station";
import {
  catalogStationNameFrom,
  lookupCatalogStation,
} from "@/lib/data/station-facility-catalog";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import {
  linkedGateForExit,
  resolveExitRecommendation,
} from "@/lib/services/facility-coordinate-selection";

export interface CatalogResolveInput {
  stationName: string;
  stationId?: string;
  stationCoordinates: Coordinates | null;
  destinationCoordinates: Coordinates | null;
  facilities?: readonly StationFacility[];
}

export interface CatalogResolveResult {
  recommendation: FacilityRecommendation;
  facilities: StationFacility[];
}

function toNamed(facility: StationFacility): NamedFacility {
  return {
    name: facility.name,
    confidence: facility.confidence,
    provenance: facility.provenance ?? "surveyed",
    coordinates: facility.coordinates,
  };
}

function unavailable(reason: string): FacilityRecommendation {
  return { state: "unavailable", reason };
}

/**
 * 収録(または OSM マージ後)の StationFacility[] から改札・出口の組を選ぶ。
 * confirmed は明示リンク(connectedGateId)で両方揃ったときだけ。
 * 片方だけの confirmed は部分表示用で、合格線には数えない。
 */
export function resolveFacilityFromCatalog(input: CatalogResolveInput): CatalogResolveResult {
  const facilities =
    input.facilities !== undefined
      ? [...input.facilities]
      : (() => {
          const key = catalogStationNameFrom({
            stationName: input.stationName,
            stationId: input.stationId,
          });
          const row = lookupCatalogStation(key);
          return row ? [...row.facilities] : [];
        })();

  if (facilities.length === 0) {
    return { recommendation: unavailable("改札・出口の収録データがありません"), facilities };
  }

  if (!input.destinationCoordinates) {
    return {
      recommendation: unavailable("目的地座標が無いため収録データでは断定しません"),
      facilities,
    };
  }

  const row = lookupCatalogStation(
    catalogStationNameFrom({ stationName: input.stationName, stationId: input.stationId })
  );
  const stationCenter =
    input.stationCoordinates ?? row?.stationCenter ?? null;

  const exitRec = resolveExitRecommendation(
    facilities,
    input.destinationCoordinates,
    stationCenter
  );

  if (exitRec.tier === "approximate") {
    return {
      recommendation: unavailable("収録出口が目的地の方角をカバーしていません"),
      facilities,
    };
  }

  if (exitRec.tier !== "exact" || exitRec.exit === null) {
    return {
      recommendation: unavailable("目的地側の出口を収録データから特定できませんでした"),
      facilities,
    };
  }

  const gate = linkedGateForExit(facilities, exitRec.exit);
  if (gate) {
    return {
      recommendation: {
        state: "confirmed",
        pair: {
          gate: toNamed(gate),
          exit: toNamed(exitRec.exit),
          reason: "目的地座標に最も近い収録出口と、その接続改札",
        },
      },
      facilities,
    };
  }

  return {
    recommendation: {
      state: "confirmed",
      pair: { gate: null, exit: toNamed(exitRec.exit), reason: "出口は収録できたが接続改札の明示リンクが無い" },
    },
    facilities,
  };
}

/**
 * 収録だけで BothHit したときの改札名。Gemini 経路生成の号車ヒントと
 * 施設再試行スキップに使う。OSM / 分割生成は見ない（経路ヘッダ開始前の同期判定）。
 */
export function catalogChosenGateNameOf(input: CatalogResolveInput): string | null {
  const { recommendation } = resolveFacilityFromCatalog(input);
  if (!isScoringBothHit(recommendation)) return null;
  return uniqueChosenGateOf(recommendation)?.name ?? null;
}

/** 到着駅と目的地座標から、収録 BothHit の改札名だけを取る。 */
export function catalogChosenGateNameFromStation(
  destinationStation: Station,
  destinationPlaceCoordinates: Coordinates | null
): string | null {
  if (!destinationPlaceCoordinates) return null;
  return catalogChosenGateNameOf({
    stationName: destinationStation.stationName,
    stationId: destinationStation.stationId,
    stationCoordinates: {
      lat: destinationStation.latitude,
      lng: destinationStation.longitude,
    },
    destinationCoordinates: destinationPlaceCoordinates,
  });
}
