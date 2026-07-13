import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteTimelineDiagramSection } from "@/components/result/RouteTimelineDiagramSection";
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
    hasApproximateGuidance: false,
    approximateDirectionLabel: null,
    arrivalGuide: {
      steps: [
        {
          type: "street_exit",
          title: "A1出口",
          instruction: "A1出口から地上へ出てください。",
          landmarks: [],
          confidence: highConfidence,
          provenance: "surveyed",
        },
      ],
      destinationDirection: null,
    },
  },
};

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "改札・出口情報を確認できません。",
};

describe("RouteTimelineDiagramSection", () => {
  test("出発駅・到着駅・出口・目的地のタイムラインを描画する", async () => {
    const element = await RouteTimelineDiagramSection({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
      destinationName: "テスト目的地",
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("出発駅");
    expect(html).toContain("到着駅");
    expect(html).toContain("A1出口");
    expect(html).toContain("テスト目的地");
  });

  test("facilitiesがok:falseの場合はエラーメッセージを描画する", async () => {
    const element = await RouteTimelineDiagramSection({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(NG_RESULT),
      destinationName: "テスト目的地",
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("改札・出口情報を確認できません。");
  });
});
