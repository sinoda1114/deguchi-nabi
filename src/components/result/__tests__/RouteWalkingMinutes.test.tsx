import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteWalkingMinutes } from "@/components/result/RouteWalkingMinutes";
import type { FacilitiesBuildSuccess, FacilitiesSearchResult } from "@/lib/services/route-search";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

function okResult(overrides: Partial<FacilitiesBuildSuccess> = {}): FacilitiesSearchResult {
  const base: FacilitiesBuildSuccess = {
    transferSegment: {
      type: "transfer",
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: null,
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    exitSegment: {
      type: "exit",
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: null,
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    recommendedExit: "東口",
    facilityRecommendation: { state: "unavailable", reason: "test" },
    elevator: null,
    hasApproximateGuidance: false,
    hasAlternativesGuidance: false,
    approximateDirectionLabel: null,
    unifiedBoardingPosition: null,
    omitIndependentBoarding: false,
    arrivalGuide: {
      steps: [],
      destinationDirection: null,
      facility: { state: "unavailable", reason: "test" },
    },
    ...overrides,
  };
  return { ok: true, result: base };
}

describe("RouteWalkingMinutes", () => {
  test("確定出口に座標があれば出口起点の目安を出す", async () => {
    const html = renderToStaticMarkup(
      await RouteWalkingMinutes({
        facilitiesPromise: Promise.resolve(
          okResult({
            arrivalGuide: {
              steps: [],
              destinationDirection: null,
              facility: {
                state: "confirmed",
                pair: {
                  gate: null,
                  exit: {
                    name: "東口",
                    confidence: highConfidence,
                    coordinates: { lat: 35.0, lng: 139.0 },
                  },
                  reason: null,
                },
              },
            },
          })
        ),
        stationCoordinates: { lat: 35.01, lng: 139.0 },
        destinationCoordinates: { lat: 35.0005, lng: 139.0 },
        estimatedDurationMinutes: 10,
        arrivalStationName: "テスト駅",
      })
    );
    expect(html).toContain("出口からの徒歩目安約");
    expect(html).not.toContain("到着駅からの徒歩目安約");
  });

  test("案内に座標が無ければ駅代表起点の目安を出す", async () => {
    const html = renderToStaticMarkup(
      await RouteWalkingMinutes({
        facilitiesPromise: Promise.resolve(okResult()),
        stationCoordinates: { lat: 35.0, lng: 139.0 },
        destinationCoordinates: { lat: 35.001, lng: 139.0 },
        estimatedDurationMinutes: 10,
        arrivalStationName: "テスト駅",
      })
    );
    expect(html).toContain("到着駅からの徒歩目安約");
  });

  test("目的地座標が無いときは行を出さない", async () => {
    const html = renderToStaticMarkup(
      await RouteWalkingMinutes({
        facilitiesPromise: Promise.resolve(okResult()),
        stationCoordinates: { lat: 35.0, lng: 139.0 },
        destinationCoordinates: null,
        estimatedDurationMinutes: 10,
        arrivalStationName: "テスト駅",
      })
    );
    expect(html).toBe("");
  });
});
