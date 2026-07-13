import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyInstructionText } from "@/components/result/KeyInstructionText";
import { KeyInstructionTextSkeleton } from "@/components/result/KeyInstructionTextSkeleton";
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
    gate: { facilityId: "g1", stationId: "d", facilityType: "gate", name: "中央改札", level: "1F", accessible: true, coordinates: null, connectedGateId: null, confidence: highConfidence, verifiedAt: null },
    exit: { facilityId: "e1", stationId: "d", facilityType: "exit", name: "A1出口", level: "1F", accessible: true, coordinates: null, connectedGateId: null, confidence: highConfidence, verifiedAt: null },
    elevator: null,
  },
};

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "改札・出口情報を確認できません。",
};

describe("KeyInstructionText", () => {
  test("ok:trueならcomputeKeyInstructionの文言を描画する", async () => {
    const element = await KeyInstructionText({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toBe("5号車付近に乗車、中央改札、A1出口へ。");
  });

  test("ok:falseならfacilitiesのエラー理由を描画する", async () => {
    const element = await KeyInstructionText({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(NG_RESULT),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toBe("改札・出口情報を確認できません。");
  });
});

describe("KeyInstructionTextSkeleton", () => {
  test("aria-hiddenなプレースホルダーを描画する", () => {
    const html = renderToStaticMarkup(<KeyInstructionTextSkeleton />);
    expect(html).toContain('aria-hidden="true"');
  });
});
