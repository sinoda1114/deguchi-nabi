import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfidenceSummarySection } from "@/components/result/ConfidenceSummarySection";
import { ConfidenceSummarySectionSkeleton } from "@/components/result/ConfidenceSummarySectionSkeleton";
import type { RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

const TRAIN_SEGMENT: RouteSegment = {
  type: "train",
  from: "出発駅",
  to: "到着駅",
  line: "テスト線",
  direction: "到着駅方面",
  platform: "1",
  boardingPosition: { carNumber: 5, doorPosition: "中央", reason: "テスト理由" },
  facilities: [],
  instruction: "テスト線で5号車付近に乗車してください。",
  confidence: highConfidence,
  sourceReferences: [],
  warnings: [],
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
    facilityRecommendation: {
      state: "confirmed",
      pair: {
        gate: { name: "中央改札", confidence: highConfidence, provenance: "surveyed" },
        exit: { name: "A1出口", confidence: highConfidence, provenance: "surveyed" },
        reason: null,
      },
    },
    elevator: null,
    hasApproximateGuidance: false,
    hasAlternativesGuidance: false,
    approximateDirectionLabel: null,
    unifiedBoardingPosition: null,
    arrivalGuide: { steps: [], destinationDirection: null, facility: { state: "unavailable", reason: "test" } },
  },
};

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "改札・出口情報を確認できません。",
};

describe("ConfidenceSummarySection", () => {
  test("train区間とfacilitiesからconfidenceSummaryを組み立てて描画する", async () => {
    const element = await ConfidenceSummarySection({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
      mode: "easy",
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("信頼度: 高");
  });

  test("facilitiesがok:falseの場合はエラーメッセージを描画する", async () => {
    const element = await ConfidenceSummarySection({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(NG_RESULT),
      mode: "easy",
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("改札・出口情報を確認できません。");
  });
});

describe("ConfidenceSummarySectionSkeleton", () => {
  test("aria-hiddenなプレースホルダーを描画する", () => {
    const html = renderToStaticMarkup(<ConfidenceSummarySectionSkeleton />);
    expect(html).toContain("skeleton-shimmer");
    expect(html).toContain('aria-hidden="true"');
  });
});
