import { describe, expect, test } from "vitest";
import type { Confidence } from "@/lib/domain/confidence";
import type { FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { UECHABE_DOGENZAKA } from "@/lib/eval/exit-quality-gate";
import { lookupCatalogStation } from "@/lib/data/station-facility-catalog";
import { haversineMeters } from "@/lib/geo/haversine";
import {
  WALKING_DETOUR_FACTOR,
  WALKING_METERS_PER_MINUTE,
  approximateWalkingDistanceMeters,
  estimateWalkingMinutes,
  estimateWalkingMinutesFromOrigin,
  walkingOriginFromGuide,
} from "@/lib/services/walking-estimate";

const highConfidence: Confidence = {
  level: "high",
  reasons: ["test"],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 1,
};

function named(
  name: string,
  coordinates: Coordinates | null = null
): NamedFacility {
  return {
    name,
    confidence: highConfidence,
    provenance: "surveyed",
    coordinates,
  };
}

function confirmed(
  gate: NamedFacility | null,
  exit: NamedFacility | null
): FacilityRecommendation {
  return { state: "confirmed", pair: { gate, exit, reason: null } };
}

function oldEstimate(distanceMeters: number): number {
  return Math.ceil(distanceMeters / 80);
}

describe("estimateWalkingMinutes", () => {
  test("直線距離に道なり係数1.3を掛け、分速80mで割り、端数を切り上げる", () => {
    expect(WALKING_DETOUR_FACTOR).toBe(1.3);
    expect(WALKING_METERS_PER_MINUTE).toBe(80);
    expect(estimateWalkingMinutes(160)).toBe(3);
    expect(estimateWalkingMinutes(161)).toBe(3);
    expect(estimateWalkingMinutes(80)).toBe(2);
  });

  test("距離がnullの場合はnullを返す(距離不明を0分と誤って断定しない)", () => {
    expect(estimateWalkingMinutes(null)).toBeNull();
  });

  test("距離が0以下の場合はnullを返す", () => {
    expect(estimateWalkingMinutes(0)).toBeNull();
    expect(estimateWalkingMinutes(-10)).toBeNull();
  });

  test("1分未満の距離でも最低1分に切り上げる(0分表示による誤解を避ける)", () => {
    expect(estimateWalkingMinutes(1)).toBe(1);
  });

  test("近傍の小規模駅距離を異常に膨らませない", () => {
    expect(estimateWalkingMinutes(40)).toBe(1);
    expect(estimateWalkingMinutes(80)).toBe(2);
    expect(estimateWalkingMinutes(100)).toBe(2);
    expect(estimateWalkingMinutes(150)).toBe(3);
    expect(estimateWalkingMinutes(200)).toBe(4);
  });
});

describe("approximateWalkingDistanceMeters", () => {
  test("起点座標と目的地座標から直線距離を算出する", () => {
    const origin: Coordinates = { lat: 35.0, lng: 139.0 };
    const destination: Coordinates = { lat: 35.001, lng: 139.0 };
    const expected = haversineMeters(35.0, 139.0, 35.001, 139.0);
    expect(approximateWalkingDistanceMeters(origin, destination)).toBeCloseTo(expected, 5);
  });

  test("起点座標が無い場合はnullを返す", () => {
    expect(approximateWalkingDistanceMeters(null, { lat: 35.0, lng: 139.0 })).toBeNull();
  });

  test("目的地座標が無い場合はnullを返す", () => {
    expect(approximateWalkingDistanceMeters({ lat: 35.0, lng: 139.0 }, null)).toBeNull();
  });
});

describe("walkingOriginFromGuide", () => {
  const station: Coordinates = { lat: 35.0, lng: 139.0 };
  const exitCoords: Coordinates = { lat: 35.001, lng: 139.0 };
  const gateCoords: Coordinates = { lat: 35.0005, lng: 139.0 };

  test("confirmed で出口座標があれば出口を起点にする", () => {
    const origin = walkingOriginFromGuide({
      recommendation: confirmed(named("北改札", gateCoords), named("東口", exitCoords)),
      stationCoordinates: station,
    });
    expect(origin).toEqual({ kind: "exit", coordinates: exitCoords });
  });

  test("出口座標が無く改札座標があれば改札を起点にする", () => {
    const origin = walkingOriginFromGuide({
      recommendation: confirmed(named("北改札", gateCoords), named("東口", null)),
      stationCoordinates: station,
    });
    expect(origin).toEqual({ kind: "gate", coordinates: gateCoords });
  });

  test("案内に座標が無ければ駅代表座標に落とす", () => {
    const origin = walkingOriginFromGuide({
      recommendation: confirmed(named("北改札"), named("東口")),
      stationCoordinates: station,
    });
    expect(origin).toEqual({ kind: "station", coordinates: station });
  });

  test("alternatives では出口を断定せず駅代表に落とす", () => {
    const origin = walkingOriginFromGuide({
      recommendation: {
        state: "alternatives",
        pairs: [
          { gate: named("北改札", gateCoords), exit: named("東口", exitCoords), reason: null },
          { gate: named("南改札"), exit: named("西口", { lat: 34.9, lng: 139.0 }), reason: null },
        ],
      },
      stationCoordinates: station,
    });
    expect(origin).toEqual({ kind: "station", coordinates: station });
  });

  test("名前が収録施設と一致し座標が案内に無いときは収録座標を使う", () => {
    const known: StationFacility[] = [
      {
        facilityId: "exit_east",
        stationId: "st",
        facilityType: "exit",
        name: "東口",
        level: "地上",
        accessible: true,
        coordinates: exitCoords,
        connectedGateId: null,
        confidence: highConfidence,
        verifiedAt: null,
        provenance: "surveyed",
      },
    ];
    const origin = walkingOriginFromGuide({
      recommendation: confirmed(null, named("東口")),
      stationCoordinates: station,
      knownFacilities: known,
    });
    expect(origin).toEqual({ kind: "exit", coordinates: exitCoords });
  });

  test("都市名・駅名の特別分岐は持たない(未収録の駅名でも駅代表に落ちる)", () => {
    const origin = walkingOriginFromGuide({
      recommendation: confirmed(named("中央改札"), named("1番出口")),
      stationCoordinates: station,
      stationName: "栄",
    });
    expect(origin).toEqual({ kind: "station", coordinates: station });
  });

  test("座標が一切無ければnull", () => {
    expect(
      walkingOriginFromGuide({
        recommendation: confirmed(named("北改札"), named("東口")),
        stationCoordinates: null,
      })
    ).toBeNull();
  });
});

describe("収録座標フィクスチャ(ウエチャベ)の前後比較", () => {
  test("駅中心は旧5分→新6分、A1出口は旧2分→新2分(Maps Directionsは未取得)", () => {
    const catalog = lookupCatalogStation("渋谷");
    expect(catalog).not.toBeNull();
    const station = catalog!.stationCenter;
    const a1 = catalog!.facilities.find((facility) => facility.name === "A1出口");
    expect(a1?.coordinates).toBeTruthy();
    const dest = UECHABE_DOGENZAKA.coordinates;

    const stationMeters = haversineMeters(station.lat, station.lng, dest.lat, dest.lng);
    const a1Meters = haversineMeters(a1!.coordinates!.lat, a1!.coordinates!.lng, dest.lat, dest.lng);

    expect(Math.round(stationMeters)).toBe(360);
    expect(Math.round(a1Meters)).toBe(107);

    expect(oldEstimate(stationMeters)).toBe(5);
    expect(estimateWalkingMinutes(stationMeters)).toBe(6);
    expect(oldEstimate(a1Meters)).toBe(2);
    expect(estimateWalkingMinutes(a1Meters)).toBe(2);

    const origin = walkingOriginFromGuide({
      recommendation: confirmed(
        named("道玄坂改札"),
        named("A1出口", a1!.coordinates)
      ),
      stationCoordinates: station,
    });
    expect(origin?.kind).toBe("exit");
    expect(estimateWalkingMinutesFromOrigin(origin, dest)).toEqual({
      minutes: 2,
      originKind: "exit",
    });
  });
});
