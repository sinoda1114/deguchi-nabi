import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecommendedExitValue } from "@/components/result/RecommendedExitValue";
import { RecommendedExitValueSkeleton } from "@/components/result/RecommendedExitValueSkeleton";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

const OK_RESULT: FacilitiesSearchResult = {
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
      instruction: "A1出口から出てください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    recommendedExit: "A1出口",
    gate: null,
    exit: null,
    elevator: null,
  },
};

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "出口情報を確認できません。",
};

describe("RecommendedExitValue", () => {
  test("ok:trueならrecommendedExitの文字列を描画する", async () => {
    const element = await RecommendedExitValue({ facilitiesPromise: Promise.resolve(OK_RESULT) });
    const html = renderToStaticMarkup(element);
    expect(html).toBe("A1出口");
  });

  test("ok:falseなら確認できない旨を描画する", async () => {
    const element = await RecommendedExitValue({ facilitiesPromise: Promise.resolve(NG_RESULT) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("確認できません");
  });
});

describe("RecommendedExitValueSkeleton", () => {
  test("aria-hiddenなプレースホルダーを描画する", () => {
    const html = renderToStaticMarkup(<RecommendedExitValueSkeleton />);
    expect(html).toContain('aria-hidden="true"');
  });
});
