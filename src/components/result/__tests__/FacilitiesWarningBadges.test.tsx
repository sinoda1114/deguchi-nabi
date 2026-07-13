import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FacilitiesWarningBadges } from "@/components/result/FacilitiesWarningBadges";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

function buildResult(hasApproximateGuidance: boolean): FacilitiesSearchResult {
  return {
    ok: true,
    result: {
      transferSegment: {
        type: "transfer",
        from: "到着駅",
        to: "到着駅",
        line: null,
        direction: null,
        platform: null,
        boardingPosition: null,
        facilities: [],
        instruction: "改札へ向かってください。",
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
        instruction: "出口から出てください。",
        confidence: highConfidence,
        sourceReferences: [],
        warnings: [],
      },
      recommendedExit: "A1出口",
      gate: null,
      exit: null,
      elevator: null,
      hasApproximateGuidance,
      approximateDirectionLabel: hasApproximateGuidance ? "西" : null,
    },
  };
}

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "出口情報を確認できません。",
};

describe("FacilitiesWarningBadges", () => {
  test("hasApproximateGuidanceがtrueなら方角のみの案内である旨を1回だけ表示する", async () => {
    const element = await FacilitiesWarningBadges({
      facilitiesPromise: Promise.resolve(buildResult(true)),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("方角");
  });

  test("hasApproximateGuidanceがfalseなら何も表示しない", async () => {
    const element = await FacilitiesWarningBadges({
      facilitiesPromise: Promise.resolve(buildResult(false)),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toBe("");
  });

  test("ok:falseの場合も何も表示しない(ErrorScreen相当の表示は呼び出し元が担う)", async () => {
    const element = await FacilitiesWarningBadges({
      facilitiesPromise: Promise.resolve(NG_RESULT),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toBe("");
  });
});
