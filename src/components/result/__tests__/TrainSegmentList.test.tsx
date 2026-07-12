import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainSegmentList } from "@/components/result/TrainSegmentList";
import { TrainSegmentListSkeleton } from "@/components/result/TrainSegmentListSkeleton";
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
  boardingPosition: { carNumber: 5, doorPosition: "中央", reason: "テスト理由" },
  facilities: [],
  instruction: "テスト線で5号車付近に乗車してください。",
  confidence: highConfidence,
  sourceReferences: [],
  warnings: [],
};

describe("TrainSegmentList", () => {
  test("Promiseが解決したtrain区間を描画する", async () => {
    const element = await TrainSegmentList({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("テスト線で5号車付近に乗車してください。");
    expect(html).toContain("route-step");
  });

  test("同じPromiseインスタンスを複数箇所でawaitしても、生成元の処理(executor)は1回しか実行されない", async () => {
    let callCount = 0;
    const trainSegmentsPromise = (async () => {
      callCount += 1;
      return [TRAIN_SEGMENT];
    })();

    await TrainSegmentList({ trainSegmentsPromise });
    await TrainSegmentList({ trainSegmentsPromise });

    expect(callCount).toBe(1);
  });
});

describe("TrainSegmentListSkeleton", () => {
  test("aria-hiddenなプレースホルダーを描画する", () => {
    const html = renderToStaticMarkup(<TrainSegmentListSkeleton />);
    expect(html).toContain("animate-pulse");
    expect(html).toContain('aria-hidden="true"');
  });
});
