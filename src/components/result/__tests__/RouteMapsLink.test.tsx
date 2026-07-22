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
    arrivalGuide: {
      steps: [],
      destinationDirection: null,
      facility: { state: "unavailable" as const, reason: "test" },
    },
    ...overrides,
  };
  return { ok: true as const, result: base };
}

const DESTINATION_COORDINATES = { lat: 35.4657, lng: 139.622 };

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
      destinationCoordinates: DESTINATION_COORDINATES,
    });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain("Google Maps");
    expect(html).toContain("35.4657");
    expect(html).toContain("139.622");
    // /ai-review指摘(Codex): origin未指定にすることで、Google Maps側が端末の
    // 現在地を起点にできる(出口を出た直後に開く想定利用と合致)。誤った出発地を
    // 断定しないよう、意図的にoriginパラメータを含めない。
    expect(html).not.toContain("origin=");
    // 「ルートを見る」等、特定の出発地からの経路を保証しているような文言にしない。
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
      destinationCoordinates: DESTINATION_COORDINATES,
    });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain("Google Maps");
  });

  test("facility.stateがunavailableの場合はリンクを表示しない", async () => {
    const element = await RouteMapsLink({
      facilitiesPromise: Promise.resolve(okResult()),
      destinationCoordinates: DESTINATION_COORDINATES,
    });
    expect(element).toBeNull();
  });

  test("destinationCoordinatesがnullの場合はリンクを表示しない(目的地が駅そのもの)", async () => {
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
      destinationCoordinates: null,
    });
    expect(element).toBeNull();
  });

  test("facilitiesPromiseがok:falseの場合はリンクを表示しない", async () => {
    const element = await RouteMapsLink({
      facilitiesPromise: Promise.resolve({ ok: false, reason: "test" }),
      destinationCoordinates: DESTINATION_COORDINATES,
    });
    expect(element).toBeNull();
  });
});
