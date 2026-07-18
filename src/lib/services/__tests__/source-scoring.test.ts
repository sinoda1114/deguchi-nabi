import { describe, expect, test } from "vitest";
import {
  isOfficialDomain,
  scoreSearchSource,
  type SearchSourceCandidate,
} from "@/lib/services/source-scoring";

function candidate(overrides: Partial<SearchSourceCandidate> = {}): SearchSourceCandidate {
  return {
    url: "https://example.com/page",
    title: "サンプルページ",
    publishedAt: null,
    ...overrides,
  };
}

describe("isOfficialDomain", () => {
  test("JR東日本の公式ドメインはtrue", () => {
    expect(isOfficialDomain("jreast.co.jp")).toBe(true);
  });

  test("東京メトロの公式ドメインはtrue", () => {
    expect(isOfficialDomain("www.tokyometro.jp")).toBe(true);
  });

  test("主要私鉄・地下鉄・JR各社の公式ドメインもtrue(PR5で追加)", () => {
    const officialHosts = [
      "www.tokyu.co.jp",
      "www.odakyu.jp",
      "www.keio.co.jp",
      "www.seiburailway.jp",
      "www.tobu.co.jp",
      "www.keisei.co.jp",
      "www.keikyu.co.jp",
      "www.sotetsu.co.jp",
      "jr-central.co.jp",
      "www.westjr.co.jp",
      "www.jr-odekake.net",
      "www.jrkyushu.co.jp",
      "www.jrhokkaido.co.jp",
      "www.osakametro.co.jp",
      "www.hankyu.co.jp",
      "www.hanshin.co.jp",
      "www.kintetsu.co.jp",
      "www.nankai.co.jp",
      "www.nishitetsu.jp",
      "www.nagoya-kotsu.jp",
    ];
    for (const host of officialHosts) {
      expect(isOfficialDomain(host)).toBe(true);
    }
  });

  test(".go.jpドメインは包括的にtrue", () => {
    expect(isOfficialDomain("www.mlit.go.jp")).toBe(true);
  });

  test(".lg.jpドメインは包括的にtrue", () => {
    expect(isOfficialDomain("www.city.example.lg.jp")).toBe(true);
  });

  test("個人ブログドメインはfalse", () => {
    expect(isOfficialDomain("example.hatenablog.com")).toBe(false);
  });

  test("go.jpに似ているが異なるドメイン(なりすまし対策)はfalse", () => {
    expect(isOfficialDomain("notgo.jp.evil.com")).toBe(false);
  });
});

describe("scoreSearchSource", () => {
  const now = new Date("2026-07-18T00:00:00Z");

  test("公式ドメインは加点され理由にドメイン名を含む", () => {
    const result = scoreSearchSource(
      candidate({ url: "https://www.jreast.co.jp/estation/stations/123.html" }),
      now
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.isOfficialDomain).toBe(true);
    expect(result.reasons.some((r) => r.includes("公式ドメイン"))).toBe(true);
  });

  test("タイトルに「構内図」を含むと加点される", () => {
    const withKeyword = scoreSearchSource(candidate({ title: "新宿駅 構内図" }), now);
    const withoutKeyword = scoreSearchSource(candidate({ title: "新宿駅について" }), now);
    expect(withKeyword.score).toBeGreaterThan(withoutKeyword.score);
  });

  test("タイトルに「出口案内」を含むと加点される", () => {
    const result = scoreSearchSource(candidate({ title: "渋谷駅 出口案内" }), now);
    expect(result.reasons.some((r) => r.includes("関連語"))).toBe(true);
  });

  test("URLが.pdfで終わると加点される", () => {
    const pdf = scoreSearchSource(candidate({ url: "https://example.com/guide.pdf" }), now);
    const html = scoreSearchSource(candidate({ url: "https://example.com/guide.html" }), now);
    expect(pdf.score).toBeGreaterThan(html.score);
  });

  test("発行日が2年以内なら加点される", () => {
    const recent = scoreSearchSource(
      candidate({ publishedAt: "2025-01-01T00:00:00Z" }),
      now
    );
    const old = scoreSearchSource(candidate({ publishedAt: "2015-01-01T00:00:00Z" }), now);
    expect(recent.score).toBeGreaterThan(old.score);
  });

  test("発行日がnullの場合は新しさによる加点も減点もない", () => {
    const withNull = scoreSearchSource(candidate({ publishedAt: null }), now);
    expect(withNull.reasons.some((r) => r.includes("発行"))).toBe(false);
  });

  test("発行日が未来の場合は新しさによる加点をしない(不正データの可能性があるため)", () => {
    const future = scoreSearchSource(
      candidate({ publishedAt: "2030-01-01T00:00:00Z" }),
      now
    );
    expect(future.reasons.some((r) => r.includes("発行"))).toBe(false);
    const withNull = scoreSearchSource(candidate({ publishedAt: null }), now);
    expect(future.score).toBe(withNull.score);
  });

  test("まとめサイト・個人ブログらしきドメインは減点される", () => {
    const blog = scoreSearchSource(
      candidate({ url: "https://station-guide.hatenablog.com/entry/1" }),
      now
    );
    const neutral = scoreSearchSource(candidate({ url: "https://example.com/entry/1" }), now);
    expect(blog.score).toBeLessThan(neutral.score);
    expect(blog.reasons.some((r) => r.includes("ブログ") || r.includes("まとめ"))).toBe(true);
  });

  test("公式ドメインと低品質ドメイン判定は排他的(公式ドメインは低品質扱いされない)", () => {
    const result = scoreSearchSource(
      candidate({ url: "https://www.tokyometro.jp/blog/example" }),
      now
    );
    expect(result.isOfficialDomain).toBe(true);
    expect(result.reasons.some((r) => r.includes("ブログ") || r.includes("まとめ"))).toBe(false);
  });

  test("不正なURLでも例外を投げず中立スコアとして扱う", () => {
    expect(() => scoreSearchSource(candidate({ url: "not-a-valid-url" }), now)).not.toThrow();
    const result = scoreSearchSource(candidate({ url: "not-a-valid-url" }), now);
    expect(result.isOfficialDomain).toBe(false);
  });

  test("公式ドメイン+関連語+PDF+最新の全条件を満たすと最高スコアになる", () => {
    const best = scoreSearchSource(
      candidate({
        url: "https://www.jreast.co.jp/estation/exit-guide.pdf",
        title: "新宿駅 出口案内 構内図",
        publishedAt: "2026-01-01T00:00:00Z",
      }),
      now
    );
    const worst = scoreSearchSource(
      candidate({
        url: "https://random.hatenablog.com/entry/old",
        title: "なんとなく書いた日記",
        publishedAt: "2010-01-01T00:00:00Z",
      }),
      now
    );
    expect(best.score).toBeGreaterThan(worst.score);
  });
});
