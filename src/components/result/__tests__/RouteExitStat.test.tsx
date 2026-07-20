import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteExitStat } from "@/components/result/RouteExitStat";
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
  return {
    ok: true,
    result: {
      transferSegment: {
        type: "transfer",
        from: "到着駅",
        to: "到着駅",
        line: null,
        direction: "中央改札方面",
        platform: null,
        boardingPosition: null,
        facilities: [],
        instruction: "中央改札へ向かってください。",
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
        instruction: "東口から出てください。",
        confidence: highConfidence,
        sourceReferences: [],
        warnings: [],
      },
      recommendedExit: "東口",
      gate: null,
      exit: null,
      elevator: null,
      hasApproximateGuidance: false,
      approximateDirectionLabel: null,
      unifiedBoardingPosition: null,
      arrivalGuide: {
        steps: [
          {
            type: "street_exit",
            title: "東口",
            instruction: "東口から地上へ出てください。",
            landmarks: [],
            confidence: highConfidence,
            provenance: "surveyed",
          },
        ],
        destinationDirection: null,
      },
      ...overrides,
    },
  };
}

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "改札・出口情報を確認できません。",
};

describe("RouteExitStat", () => {
  test("具体的な出口名を表示する", async () => {
    const element = await RouteExitStat({ facilitiesPromise: Promise.resolve(okResult()) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("東口");
    expect(html).toContain("利用出口");
  });

  test("出口名が確認できず方角のみ判明している場合、方角を出口名として使わず推奨方向として区別して表示する", async () => {
    const element = await RouteExitStat({
      facilitiesPromise: Promise.resolve(
        okResult({ arrivalGuide: { steps: [], destinationDirection: "南" } })
      ),
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toMatch(/利用出口[\s\S]{0,80}>南側</);
    expect(html).toContain("推奨方向: 南側");
  });

  test("confidenceがhigh以外の場合、「未確認情報」の注記を表示する", async () => {
    const element = await RouteExitStat({
      facilitiesPromise: Promise.resolve(
        okResult({
          arrivalGuide: {
            steps: [
              {
                type: "street_exit",
                title: "南口",
                instruction: "南口から地上へ出てください。",
                landmarks: [],
                confidence: { level: "low", reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 0 },
                provenance: "map_estimate",
              },
            ],
            destinationDirection: null,
          },
        })
      ),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("南口");
    expect(html).toContain("未確認情報");
  });

  test("facilitiesがok:falseの場合は確認できない旨を表示する", async () => {
    const element = await RouteExitStat({ facilitiesPromise: Promise.resolve(NG_RESULT) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("確認できません");
  });
});
