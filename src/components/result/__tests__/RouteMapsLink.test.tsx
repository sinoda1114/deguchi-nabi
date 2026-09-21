import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteMapsLink } from "@/components/result/RouteMapsLink";
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
      type: "transfer" as const,
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
      type: "exit" as const,
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
    facilityRecommendation: { state: "unavailable" as const, reason: "test" },
    elevator: null,
    hasApproximateGuidance: false,
    hasAlternativesGuidance: false,
    approximateDirectionLabel: null,
    unifiedBoardingPosition: null,
    omitIndependentBoarding: false,
    gateExitRelation: { kind: "separate_exit", reason: "test" },
    arrivalGuide: {
      steps: [],
      destinationDirection: null,
      facility: { state: "unavailable" as const, reason: "test" },
    },
    ...overrides,
  };
  return { ok: true as const, result: base };
}

const DESTINATION = {
  name: "GINZA春秋 首都横浜店",
  placeId: "ChIJ_testPlace",
  coordinates: { lat: 35.4657, lng: 139.622 },
};

describe("RouteMapsLink", () => {
  test("facility.stateがconfirmedの場合、Google Mapsリンクを表示する", async () => {
    const element = await RouteMapsLink({
      facilitiesPromise: Promise.resolve(
        okResult({
          arrivalGuide: {
            steps: [],
            destinationDirection: null,
            facility: {
              state: "confirmed",
              pair: { gate: null, exit: { name: "東口", confidence: highConfidence }, reason: null },
            },
          },
        })
      ),
      destination: DESTINATION,
    });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain("Google Maps");
    expect(html).toContain("query_place_id=ChIJ_testPlace");
    expect(html).toContain(encodeURIComponent("GINZA春秋 首都横浜店"));
    expect(html).not.toContain("35.4657");
    expect(html).not.toContain("origin=");
    expect(html).toContain("目的地を開く");
  });

  test("facility.stateがalternativesの場合もGoogle Mapsリンクを表示する", async () => {
    const element = await RouteMapsLink({
      facilitiesPromise: Promise.resolve(
        okResult({
          arrivalGuide: {
            steps: [],
            destinationDirection: null,
            facility: {
              state: "alternatives",
              pairs: [
                { gate: null, exit: { name: "東口", confidence: highConfidence }, reason: null },
                { gate: null, exit: { name: "西口", confidence: highConfidence }, reason: null },
              ],
            },
          },
        })
      ),
      destination: DESTINATION,
    });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain("Google Maps");
  });

  test("facility.stateがunavailableの場合はリンクを表示しない", async () => {
    const element = await RouteMapsLink({
      facilitiesPromise: Promise.resolve(okResult()),
      destination: DESTINATION,
    });
    expect(element).toBeNull();
  });

  test("destinationがnullの場合はリンクを表示しない(目的地が駅そのもの)", async () => {
    const element = await RouteMapsLink({
      facilitiesPromise: Promise.resolve(
        okResult({
          arrivalGuide: {
            steps: [],
            destinationDirection: null,
            facility: {
              state: "confirmed",
              pair: { gate: null, exit: { name: "東口", confidence: highConfidence }, reason: null },
            },
          },
        })
      ),
      destination: null,
    });
    expect(element).toBeNull();
  });

  test("facilitiesPromiseがok:falseの場合はリンクを表示しない", async () => {
    const element = await RouteMapsLink({
      facilitiesPromise: Promise.resolve({ ok: false, reason: "test" }),
      destination: DESTINATION,
    });
    expect(element).toBeNull();
  });
});
