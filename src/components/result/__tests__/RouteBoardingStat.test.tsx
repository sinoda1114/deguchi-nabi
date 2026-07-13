import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteBoardingStat } from "@/components/result/RouteBoardingStat";
import type { RouteSegment } from "@/lib/domain/route";
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
  boardingPosition: { carNumber: 8, doorPosition: "前方", reason: "テスト理由" },
  facilities: [],
  instruction: "テスト線で8号車付近に乗車してください。",
  confidence: highConfidence,
  sourceReferences: [],
  warnings: [],
};

describe("RouteBoardingStat", () => {
  test("号車・扉位置を表示する", async () => {
    const element = await RouteBoardingStat({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("8号車");
    expect(html).toContain("前方");
  });

  test("号車情報が無い場合は確認できない旨を表示する", async () => {
    const element = await RouteBoardingStat({
      trainSegmentsPromise: Promise.resolve([{ ...TRAIN_SEGMENT, boardingPosition: null }]),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("確認できません");
  });
});
