import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TransferExitSegmentList } from "@/components/result/TransferExitSegmentList";
import { TransferExitSegmentListSkeleton } from "@/components/result/TransferExitSegmentListSkeleton";
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
  reason: "バリアフリー経路を確認できません。駅係員への確認をおすすめします。",
};

describe("TransferExitSegmentList", () => {
  test("ok:true の場合は乗換・出口セグメントを描画する", async () => {
    const element = await TransferExitSegmentList({
      facilitiesPromise: Promise.resolve(OK_RESULT),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("中央改札へ向かってください。");
    expect(html).toContain("A1出口から出てください。");
  });

  test("ok:false の場合はエラーメッセージを描画する", async () => {
    const element = await TransferExitSegmentList({
      facilitiesPromise: Promise.resolve(NG_RESULT),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("バリアフリー経路を確認できません");
  });
});

describe("TransferExitSegmentListSkeleton", () => {
  test("aria-hiddenなプレースホルダーを描画する", () => {
    const html = renderToStaticMarkup(<TransferExitSegmentListSkeleton />);
    expect(html).toContain("animate-pulse");
    expect(html).toContain('aria-hidden="true"');
  });
});
