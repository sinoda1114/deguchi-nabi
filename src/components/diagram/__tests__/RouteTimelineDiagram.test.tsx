import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteTimelineDiagram } from "@/components/diagram/RouteTimelineDiagram";
import type { RouteTimelineNode } from "@/lib/services/route-timeline-nodes";

const NODES: RouteTimelineNode[] = [
  { label: "西谷駅", icon: "start", sub: null },
  { label: "横浜駅", icon: "train", sub: "10号車" },
  { label: "東口", icon: "exit", sub: null },
  { label: "マクドナルド 横浜ベイクォーター店", icon: "destination", sub: null },
];

describe("RouteTimelineDiagram", () => {
  test("各ノードの駅名・施設名を描画する", () => {
    const html = renderToStaticMarkup(<RouteTimelineDiagram nodes={NODES} />);
    expect(html).toContain("西谷駅");
    expect(html).toContain("横浜駅");
    expect(html).toContain("東口");
    expect(html).toContain("マクドナルド 横浜ベイクォーター店");
  });

  test("補足情報(号車等)がある場合は表示する", () => {
    const html = renderToStaticMarkup(<RouteTimelineDiagram nodes={NODES} />);
    expect(html).toContain("10号車");
  });

  test("最後のノード以外は接続線を描画する", () => {
    const html = renderToStaticMarkup(<RouteTimelineDiagram nodes={NODES} />);
    const connectorCount = (html.match(/route-timeline-connector/g) ?? []).length;
    expect(connectorCount).toBe(NODES.length - 1);
  });

  test("空配列を渡してもクラッシュしない", () => {
    const html = renderToStaticMarkup(<RouteTimelineDiagram nodes={[]} />);
    expect(html).toBeTruthy();
  });

  test("ノードの丸アイコンの文字色に背景色ごとのforegroundを使う(text-white固定だとコントラスト不足になるため)", () => {
    const html = renderToStaticMarkup(<RouteTimelineDiagram nodes={NODES} />);
    expect(html).toContain("var(--background)");
    expect(html).toContain("var(--segment-train-foreground)");
    expect(html).toContain("var(--accent-foreground)");
    expect(html).toContain("var(--danger-foreground)");
    expect(html).not.toContain("text-white");
  });
});
