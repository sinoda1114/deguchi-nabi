import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteTimeline } from "@/components/timeline/RouteTimeline";
import type { RouteSegment } from "@/lib/domain/route";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

function makeSegment(type: RouteSegment["type"], instruction: string): RouteSegment {
  return {
    type,
    from: "A",
    to: "B",
    line: null,
    direction: null,
    platform: null,
    boardingPosition: null,
    facilities: [],
    instruction,
    confidence: highConfidence,
    sourceReferences: [],
    warnings: [],
  };
}

describe("RouteTimeline", () => {
  test("親の <ol> に route-steps-container クラスを付与し counter-reset を1回だけ持たせる", () => {
    const segments = [makeSegment("train", "乗車してください。"), makeSegment("exit", "出口から出てください。")];
    const html = renderToStaticMarkup(<RouteTimeline segments={segments} />);
    const matches = html.match(/route-steps-container/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("各セグメントは route-step クラスの li として描画される", () => {
    const segments = [makeSegment("train", "乗車してください。"), makeSegment("exit", "出口から出てください。")];
    const html = renderToStaticMarkup(<RouteTimeline segments={segments} />);
    // "route-step-label" と区別するため、class 属性の先頭トークンとして
    // 完全一致する "route-step " のみを数える
    const matches = html.match(/class="route-step /g) ?? [];
    expect(matches.length).toBe(2);
    expect(html).toContain("乗車してください。");
    expect(html).toContain("出口から出てください。");
  });
});
