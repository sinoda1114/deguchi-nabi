import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentDetail } from "@/components/diagram/SegmentDetail";
import type { RouteSegment } from "@/lib/domain/route";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

const SEGMENT: RouteSegment = {
  type: "train",
  from: "出発駅",
  to: "到着駅",
  line: "テスト線",
  direction: "到着駅方面",
  platform: "3",
  boardingPosition: {
    carNumber: 5,
    doorPosition: "中央",
    reason: "乗換改札に近いため",
  },
  facilities: [],
  instruction: "テスト線で5号車付近に乗車してください。",
  confidence: highConfidence,
  sourceReferences: [],
  warnings: [],
};

describe("SegmentDetail", () => {
  test("常に詳細情報(instruction文・ホーム番号・理由)を表示する(トグル操作不要)", () => {
    const html = renderToStaticMarkup(<SegmentDetail segment={SEGMENT} />);
    expect(html).toContain("テスト線で5号車付近に乗車してください。");
    expect(html).toContain("3番線");
    expect(html).toContain("乗換改札に近いため");
  });

  test("開閉ボタンを描画しない(トグルUIを廃止したため)", () => {
    const html = renderToStaticMarkup(<SegmentDetail segment={SEGMENT} />);
    expect(html).not.toMatch(/<button/);
  });

  test("ホーム番号情報が無い区間ではホーム欄を表示しない", () => {
    const html = renderToStaticMarkup(
      <SegmentDetail segment={{ ...SEGMENT, platform: null }} />
    );
    expect(html).not.toContain("番線");
  });

  test("乗車理由が無い区間では理由欄を表示しない", () => {
    const html = renderToStaticMarkup(
      <SegmentDetail
        segment={{
          ...SEGMENT,
          boardingPosition: { carNumber: 5, doorPosition: "中央", reason: "" },
        }}
      />
    );
    expect(html).not.toContain("理由:");
  });
});
