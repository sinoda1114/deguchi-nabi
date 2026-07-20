import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteGateStat } from "@/components/result/RouteGateStat";
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
            type: "ticket_gate",
            title: "中央改札",
            instruction: "中央改札を利用してください。",
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

describe("RouteGateStat", () => {
  test("具体的な改札名を表示する", async () => {
    const element = await RouteGateStat({ facilitiesPromise: Promise.resolve(okResult()) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("中央改札");
    expect(html).toContain("利用改札");
  });

  test("改札名が確認できない場合、方角を代用せず「確認できません」と表示する", async () => {
    const element = await RouteGateStat({
      facilitiesPromise: Promise.resolve(
        okResult({ arrivalGuide: { steps: [], destinationDirection: "南" } })
      ),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("確認できません");
    expect(html).not.toContain("南側");
  });

  test("confidenceがhigh以外の場合、「未確認情報」の注記を表示する", async () => {
    const element = await RouteGateStat({
      facilitiesPromise: Promise.resolve(
        okResult({
          arrivalGuide: {
            steps: [
              {
                type: "ticket_gate",
                title: "西改札",
                instruction: "西改札を利用してください。",
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
    expect(html).toContain("西改札");
    expect(html).toContain("未確認情報");
  });

  test("facilitiesがok:falseの場合は確認できない旨を表示する", async () => {
    const element = await RouteGateStat({ facilitiesPromise: Promise.resolve(NG_RESULT) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("確認できません");
  });
});
