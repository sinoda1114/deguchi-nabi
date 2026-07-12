import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteSegmentListItem } from "@/components/timeline/RouteSegmentListItem";
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

describe("RouteSegmentListItem", () => {
  test("li要素に route-step クラスを付与し、STEP番号はJSで採番しない(CSS counterに委譲する)", () => {
    const html = renderToStaticMarkup(<RouteSegmentListItem segment={TRAIN_SEGMENT} />);
    expect(html).toContain("route-step");
    // JS側で "STEP 1" のような固定番号テキストを出力しないこと(CSS counterに委譲するため)
    expect(html).not.toMatch(/STEP\s*\d/);
  });

  test("segment.instruction を表示する", () => {
    const html = renderToStaticMarkup(<RouteSegmentListItem segment={TRAIN_SEGMENT} />);
    expect(html).toContain("テスト線で5号車付近に乗車してください。");
  });

  test("route-step-label クラスを持つ要素にセグメント種別のラベルを表示する", () => {
    const html = renderToStaticMarkup(<RouteSegmentListItem segment={TRAIN_SEGMENT} />);
    expect(html).toContain("route-step-label");
    expect(html).toContain("乗車");
  });
});
