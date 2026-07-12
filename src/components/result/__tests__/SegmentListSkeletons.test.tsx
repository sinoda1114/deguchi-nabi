import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainSegmentListSkeleton } from "@/components/result/TrainSegmentListSkeleton";
import { TransferExitSegmentListSkeleton } from "@/components/result/TransferExitSegmentListSkeleton";

describe("TrainSegmentListSkeleton", () => {
  test("号車情報を確認中である旨のテキストを描画する", () => {
    const html = renderToStaticMarkup(<TrainSegmentListSkeleton />);
    expect(html).toContain("号車情報を確認しています");
  });

  test("進捗ラベルはrole=statusを持ち、支援技術に読み上げられる(装飾用プレースホルダーはaria-hiddenのまま)", () => {
    const html = renderToStaticMarkup(<TrainSegmentListSkeleton />);
    expect(html).toMatch(/<p[^>]*role="status"[^>]*>号車情報を確認しています/);
    expect(html).toMatch(/<ol[^>]*aria-hidden="true"/);
  });

  test("既存のプレースホルダー(animate-pulse)は維持される", () => {
    const html = renderToStaticMarkup(<TrainSegmentListSkeleton />);
    expect(html).toContain("animate-pulse");
  });
});

describe("TransferExitSegmentListSkeleton", () => {
  test("改札・出口情報を確認中である旨のテキストを描画する", () => {
    const html = renderToStaticMarkup(<TransferExitSegmentListSkeleton />);
    expect(html).toContain("改札・出口情報を確認しています");
  });

  test("進捗ラベルはrole=statusを持ち、支援技術に読み上げられる(装飾用プレースホルダーはaria-hiddenのまま)", () => {
    const html = renderToStaticMarkup(<TransferExitSegmentListSkeleton />);
    expect(html).toMatch(/<p[^>]*role="status"[^>]*>改札・出口情報を確認しています/);
    expect(html).toMatch(/<ol[^>]*aria-hidden="true"/);
  });

  test("既存のプレースホルダー(animate-pulse)は維持される", () => {
    const html = renderToStaticMarkup(<TransferExitSegmentListSkeleton />);
    expect(html).toContain("animate-pulse");
  });
});
