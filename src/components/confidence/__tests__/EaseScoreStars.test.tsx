import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EaseScoreStars } from "@/components/confidence/EaseScoreStars";

describe("EaseScoreStars", () => {
  test("スコア分だけ塗りつぶした星を描画する(score=3なら塗り3・空2)", () => {
    const html = renderToStaticMarkup(<EaseScoreStars score={3} />);
    const filledCount = (html.match(/data-filled="true"/g) ?? []).length;
    const emptyCount = (html.match(/data-filled="false"/g) ?? []).length;
    expect(filledCount).toBe(3);
    expect(emptyCount).toBe(2);
  });

  test("スコアが1未満・5超でも1〜5の範囲にクランプする(不正値でクラッシュしない)", () => {
    const tooLow = renderToStaticMarkup(<EaseScoreStars score={0} />);
    // 下限は1(★0個という表示は「全く迷いにくさが分からない」という
    // 誤解を招くため、最低でも★1個は表示する設計)。
    expect((tooLow.match(/data-filled="true"/g) ?? []).length).toBe(1);

    const tooHigh = renderToStaticMarkup(<EaseScoreStars score={9} />);
    expect((tooHigh.match(/data-filled="true"/g) ?? []).length).toBe(5);
  });

  test("スクリーンリーダー向けにスコアをaria-labelで伝える", () => {
    const html = renderToStaticMarkup(<EaseScoreStars score={4} />);
    expect(html).toContain('aria-label="迷いにくさ 5段階中4"');
  });
});
