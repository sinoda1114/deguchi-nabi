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
      facilityRecommendation: { state: "unavailable", reason: "test" },
      elevator: null,
      hasApproximateGuidance: false,
      hasAlternativesGuidance: false,
      approximateDirectionLabel: null,
      unifiedBoardingPosition: null,
      omitIndependentBoarding: false,
      gateExitRelation: { kind: "separate_exit", reason: "test" },
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
        facility: {
          state: "confirmed",
          pair: {
            gate: null,
            exit: { name: "東口", confidence: highConfidence, provenance: "surveyed" },
            reason: null,
          },
        },
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
        okResult({
          arrivalGuide: {
            steps: [],
            destinationDirection: "南",
            facility: { state: "unavailable", reason: "test" },
          },
        })
      ),
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toMatch(/利用出口[\s\S]{0,80}>南側</);
    expect(html).toContain("推奨方向: 南側");
  });

  test("confidenceがhigh以外でも出口名自体は隠さず表示する(注記は付けない)", async () => {
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
            facility: {
              state: "confirmed",
              pair: {
                gate: null,
                exit: {
                  name: "南口",
                  confidence: { level: "low", reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 0 },
                  provenance: "map_estimate",
                },
                reason: null,
              },
            },
          },
        })
      ),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("南口");
    expect(html).not.toContain("未確認情報");
  });

  test("gate_equals_exit のときは改札名を出口欄に出し確認不能とは書かない", async () => {
    const element = await RouteExitStat({
      facilitiesPromise: Promise.resolve(
        okResult({
          gateExitRelation: {
            kind: "gate_equals_exit",
            reason: "地上改札の合図があり、独立出口も地下鉄文脈も無い",
          },
          arrivalGuide: {
            steps: [
              {
                type: "ticket_gate",
                title: "2階改札口",
                instruction: "2階改札口を利用してください。",
                landmarks: [],
                confidence: highConfidence,
                provenance: "ai_inferred",
              },
              {
                type: "street_exit",
                title: "この改札が出口です",
                instruction: "この改札が出口です。改札を出ると地上です。",
                landmarks: [],
                confidence: highConfidence,
                provenance: "ai_inferred",
              },
            ],
            destinationDirection: null,
            facility: {
              state: "confirmed",
              pair: {
                gate: { name: "2階改札口", confidence: highConfidence },
                exit: null,
                reason: null,
              },
            },
            gateExitRelation: {
              kind: "gate_equals_exit",
              reason: "地上改札の合図があり、独立出口も地下鉄文脈も無い",
            },
          },
        })
      ),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("2階改札口");
    expect(html).toContain("この改札が出口です");
    expect(html).not.toContain("確認できません");
  });

  test("facilitiesがok:falseの場合は確認できない旨を表示する", async () => {
    const element = await RouteExitStat({ facilitiesPromise: Promise.resolve(NG_RESULT) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("確認できません");
  });
});
