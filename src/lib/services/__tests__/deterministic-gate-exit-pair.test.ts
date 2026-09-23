import { describe, expect, test } from "vitest";
import type { StationFacility } from "@/lib/domain/station";
import { lowConfidence } from "@/lib/domain/confidence";
import {
  countKnownSeparateExits,
  pairConfirmedGateWithMapExit,
} from "@/lib/services/deterministic-gate-exit-pair";
import { isScoringBothHit } from "@/lib/eval/both-hit";

function mapExit(name: string, lat: number, lng: number): StationFacility {
  return {
    facilityId: `osm_${name}`,
    stationId: "st_test",
    facilityType: "exit",
    name,
    level: "地上",
    accessible: true,
    coordinates: { lat, lng },
    connectedGateId: null,
    confidence: lowConfidence("osm"),
    verifiedAt: null,
    provenance: "map_estimate",
  };
}

describe("pairConfirmedGateWithMapExit", () => {
  const center = { lat: 35.9064, lng: 139.6241 };
  const destEast = { lat: 35.9065, lng: 139.626 };

  test("地図出口が目的地方向に一致すれば改札とペアにする", () => {
    const gate = {
      name: "中央改札",
      confidence: lowConfidence("ai"),
      provenance: "ai_inferred" as const,
    };
    const facilities = [
      mapExit("西口", center.lat, center.lng - 0.001),
      mapExit("東口", center.lat, center.lng + 0.001),
    ];
    const rec = pairConfirmedGateWithMapExit(gate, facilities, destEast, center);
    expect(rec).not.toBeNull();
    expect(isScoringBothHit(rec!)).toBe(true);
    if (rec?.state === "confirmed") {
      expect(rec.pair.gate?.name).toBe("中央改札");
      expect(rec.pair.exit?.name).toBe("東口");
    }
  });

  test("AI 推定だけの出口リストではペアにしない", () => {
    const gate = {
      name: "中央改札",
      confidence: lowConfidence("ai"),
      provenance: "ai_inferred" as const,
    };
    const aiExit: StationFacility = {
      ...mapExit("東口", center.lat, center.lng + 0.001),
      provenance: "ai_inferred",
    };
    expect(pairConfirmedGateWithMapExit(gate, [aiExit], destEast, center)).toBeNull();
  });
});

describe("countKnownSeparateExits", () => {
  test("出口が無いとき null", () => {
    expect(countKnownSeparateExits([], null)).toBeNull();
  });

  test("出口件数を数える", () => {
    const center = { lat: 35, lng: 139 };
    expect(
      countKnownSeparateExits(
        [mapExit("A", center.lat + 0.001, center.lng), mapExit("B", center.lat, center.lng + 0.001)],
        center
      )
    ).toBe(2);
  });

  test("駅中心から遠い地図出口は数えない", () => {
    const center = { lat: 35, lng: 139 };
    const near = mapExit("近い", center.lat + 0.0005, center.lng);
    const far = mapExit("遠い", center.lat + 0.05, center.lng);
    expect(countKnownSeparateExits([near, far], center)).toBe(1);
  });
});
