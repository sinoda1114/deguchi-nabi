// @vitest-environment jsdom
import { describe, expect, test, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentDetailToggle } from "@/components/diagram/SegmentDetailToggle";
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

describe("SegmentDetailToggle", () => {
  test("初期状態では詳細情報(instruction文・理由)を表示しない", () => {
    const html = renderToStaticMarkup(<SegmentDetailToggle segment={SEGMENT} />);
    expect(html).not.toContain("乗換改札に近いため");
  });

  test("開閉ボタンを描画する", () => {
    const html = renderToStaticMarkup(<SegmentDetailToggle segment={SEGMENT} />);
    expect(html).toMatch(/<button[^>]*type="button"/);
  });

  test("ボタンのaria-labelに区間名(from→to)を含める(複数カードが同一名称にならないよう区別するため)", () => {
    const html = renderToStaticMarkup(<SegmentDetailToggle segment={SEGMENT} />);
    expect(html).toContain('aria-label="出発駅から到着駅までの詳細を見る"');
  });


  describe("クリック時の挙動", () => {
    let container: HTMLDivElement;
    let root: Root;

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
    });

    test("ボタンを押すと詳細情報(instruction文・ホーム番号・理由)を表示する", () => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root.render(<SegmentDetailToggle segment={SEGMENT} />);
      });

      const button = container.querySelector("button");
      expect(button).not.toBeNull();

      act(() => {
        button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(container.textContent).toContain("テスト線で5号車付近に乗車してください。");
      expect(container.textContent).toContain("3番線");
      expect(container.textContent).toContain("乗換改札に近いため");

      // aria-controlsが指すidを持つ要素が実際に展開領域として存在すること
      const controlledId = button!.getAttribute("aria-controls");
      expect(controlledId).not.toBeNull();
      expect(document.getElementById(controlledId!)).not.toBeNull();
    });

    test("もう一度押すと詳細情報を再び隠す", () => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root.render(<SegmentDetailToggle segment={SEGMENT} />);
      });

      const button = container.querySelector("button")!;
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(container.textContent).toContain("乗換改札に近いため");

      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(container.textContent).not.toContain("乗換改札に近いため");
    });
  });
});
