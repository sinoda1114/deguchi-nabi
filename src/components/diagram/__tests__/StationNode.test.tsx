import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StationNode } from "@/components/diagram/StationNode";

describe("StationNode", () => {
  test("駅名を描画する", () => {
    const html = renderToStaticMarkup(
      <StationNode
        name="西谷駅"
        accent="var(--segment-train)"
        foreground="var(--segment-train-foreground)"
      />
    );
    expect(html).toContain("西谷駅");
  });

  test("accentカラーをドットの背景色として反映する(セグメント種別を色で瞬時に区別するため)", () => {
    const html = renderToStaticMarkup(
      <StationNode
        name="西谷駅"
        accent="var(--segment-train)"
        foreground="var(--segment-train-foreground)"
      />
    );
    expect(html).toContain("background-color:var(--segment-train)");
  });

  test("stepNumberとstepLabelを渡すと丸番号バッジを描画し、foregroundを文字色として反映する(text-white固定だとコントラスト不足になるため)", () => {
    const html = renderToStaticMarkup(
      <StationNode
        name="西谷駅"
        accent="var(--segment-train)"
        foreground="var(--segment-train-foreground)"
        stepNumber={1}
        stepLabel="乗車"
      />
    );
    expect(html).toContain("1");
    expect(html).toContain("乗車");
    expect(html).toContain("color:var(--segment-train-foreground)");
  });

  test("stepNumberが無い場合はバッジを描画しない", () => {
    const html = renderToStaticMarkup(
      <StationNode
        name="西谷駅"
        accent="var(--segment-train)"
        foreground="var(--segment-train-foreground)"
      />
    );
    expect(html).not.toContain("乗車");
  });

  test("childrenを渡すと駅名の下に描画する", () => {
    const html = renderToStaticMarkup(
      <StationNode
        name="西谷駅"
        accent="var(--segment-train)"
        foreground="var(--segment-train-foreground)"
      >
        <span>詳細情報</span>
      </StationNode>
    );
    expect(html).toContain("詳細情報");
  });
});
