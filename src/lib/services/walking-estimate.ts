import type { FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import {
  catalogStationNameFrom,
  lookupCatalogStation,
} from "@/lib/data/station-facility-catalog";
import { haversineMeters } from "@/lib/geo/haversine";

/**
 * 徒歩分速(メートル/分)。「不動産の表示に関する公正競争規約」が定める
 * 徒歩所要時間の算出基準(道路距離80mを1分)を踏襲する。
 */
export const WALKING_METERS_PER_MINUTE = 80;

/**
 * 直線距離に対する道なり係数。格子街路の歩行 circuity としてよく出る
 * 1.2〜1.4 の中央付近。都市・駅名では分岐しない。ハバースインは道なりより
 * 短いので、この係数を掛けてから分速で割る。
 */
export const WALKING_DETOUR_FACTOR = 1.3;

/**
 * 徒歩起点の種別。案内が確定した出口/改札に座標があるときはそちらを使い、
 * 無ければ到着駅の代表座標に落とす。都市名・駅名での分岐は持たない。
 */
export type WalkingOriginKind = "exit" | "gate" | "station";

export interface WalkingOrigin {
  kind: WalkingOriginKind;
  coordinates: Coordinates;
}

export interface WalkingMinutesEstimate {
  minutes: number;
  originKind: WalkingOriginKind;
}

/**
 * 2点間の直線距離(近似値)。実際の徒歩経路(道なり)より短く見積もられうる。
 * どちらかの座標が無い場合は比較不能としてnullを返す。
 */
export function approximateWalkingDistanceMeters(
  originCoordinates: Coordinates | null | undefined,
  destinationCoordinates: Coordinates | null
): number | null {
  if (!originCoordinates || !destinationCoordinates) return null;
  return haversineMeters(
    originCoordinates.lat,
    originCoordinates.lng,
    destinationCoordinates.lat,
    destinationCoordinates.lng
  );
}

/**
 * 直線距離(近似値)から徒歩分数を概算する。距離がnull、または0以下の
 * 場合はnullを返す。道なり係数を掛けてから分速で割り、端数は切り上げる。
 */
export function estimateWalkingMinutes(distanceMeters: number | null): number | null {
  if (distanceMeters === null || distanceMeters <= 0) return null;
  return Math.ceil((distanceMeters * WALKING_DETOUR_FACTOR) / WALKING_METERS_PER_MINUTE);
}

function namedFacilityCoordinates(
  facility: NamedFacility | null | undefined,
  knownFacilities: readonly StationFacility[]
): Coordinates | null {
  if (!facility) return null;
  if (facility.coordinates) return facility.coordinates;
  const match = knownFacilities.find(
    (candidate) => candidate.name === facility.name && candidate.coordinates !== null
  );
  return match?.coordinates ?? null;
}

function catalogFacilitiesForStation(stationName: string | undefined): readonly StationFacility[] {
  if (!stationName) return [];
  const key = catalogStationNameFrom({ stationName });
  return lookupCatalogStation(key)?.facilities ?? [];
}

/**
 * 確定案内の出口座標 → 改札座標 → 駅代表座標、の順で徒歩起点を決める。
 * alternatives はどれか1件を「その出口」と断定できないため駅代表に落とす。
 */
export function walkingOriginFromGuide(input: {
  recommendation: FacilityRecommendation | null | undefined;
  stationCoordinates: Coordinates | null | undefined;
  stationName?: string;
  knownFacilities?: readonly StationFacility[];
}): WalkingOrigin | null {
  const known = input.knownFacilities ?? catalogFacilitiesForStation(input.stationName);
  if (input.recommendation?.state === "confirmed") {
    const exitCoordinates = namedFacilityCoordinates(input.recommendation.pair.exit, known);
    if (exitCoordinates) {
      return { kind: "exit", coordinates: exitCoordinates };
    }
    const gateCoordinates = namedFacilityCoordinates(input.recommendation.pair.gate, known);
    if (gateCoordinates) {
      return { kind: "gate", coordinates: gateCoordinates };
    }
  }
  if (input.stationCoordinates) {
    return { kind: "station", coordinates: input.stationCoordinates };
  }
  return null;
}

export function estimateWalkingMinutesFromOrigin(
  origin: WalkingOrigin | null,
  destinationCoordinates: Coordinates | null
): WalkingMinutesEstimate | null {
  if (!origin) return null;
  const minutes = estimateWalkingMinutes(
    approximateWalkingDistanceMeters(origin.coordinates, destinationCoordinates)
  );
  if (minutes === null) return null;
  return { minutes, originKind: origin.kind };
}
