import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WarningBadgeList } from "@/components/diagram/WarningBadgeList";

describe("WarningBadgeList", () => {
  test("複数の警告文言を1つの箱の中に箇条書きで表示する", () => {
    const html = renderToStaticMarkup(
      <WarningBadgeList texts={["警告その1", "警告その2"]} />
    );
    // <ul>が1つだけ(1枚の箱にまとまっている)であること。
    expect((html.match(/<ul/g) ?? []).length).toBe(1);
    expect((html.match(/<li/g) ?? []).length).toBe(2);
    expect(html).toContain("警告その1");
    expect(html).toContain("警告その2");
  });

  test("textsが空配列の場合は何もレンダリングしない", () => {
    const html = renderToStaticMarkup(<WarningBadgeList texts={[]} />);
    expect(html).toBe("");
  });

  test("1件だけの場合も箱の中に箇条書きで表示する", () => {
    const html = renderToStaticMarkup(<WarningBadgeList texts={["警告その1"]} />);
    expect((html.match(/<li/g) ?? []).length).toBe(1);
    expect(html).toContain("警告その1");
  });
});
