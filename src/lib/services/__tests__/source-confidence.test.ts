import { describe, expect, test } from "vitest";
import { deriveSourceConfidence } from "@/lib/services/source-confidence";
import { scoreSearchSource, type ScoredSearchSource } from "@/lib/services/source-scoring";

const now = new Date("2026-07-18T00:00:00Z");

function official(overrides: Partial<Parameters<typeof scoreSearchSource>[0]> = {}) {
  return scoreSearchSource(
    {
      url: "https://www.jreast.co.jp/estation/stations/123.html",
      title: "新宿駅 構内図",
      publishedAt: "2026-01-01T00:00:00Z",
      ...overrides,
    },
    now
  );
}

function lowQuality(overrides: Partial<Parameters<typeof scoreSearchSource>[0]> = {}) {
  return scoreSearchSource(
    {
      url: "https://random.hatenablog.com/entry/1",
      title: "なんとなく書いた日記",
      publishedAt: "2010-01-01T00:00:00Z",
      ...overrides,
    },
    now
  );
}

describe("deriveSourceConfidence", () => {
  test("空配列はunavailableを返す", () => {
    const result = deriveSourceConfidence([]);
    expect(result.level).toBe("unavailable");
    expect(result.sourceCount).toBe(0);
  });

  test("全ソースが低品質(有効スコアなし)の場合はunavailableを返す", () => {
    const sources: ScoredSearchSource[] = [lowQuality(), lowQuality({ url: "https://another.hatenablog.com/x" })];
    const result = deriveSourceConfidence(sources);
    expect(result.level).toBe("unavailable");
  });

  test("公式ドメイン1件のみの場合、AI由来の上限(medium)に丸められる", () => {
    const result = deriveSourceConfidence([official()]);
    expect(result.level).toBe("medium");
    expect(result.sourceCount).toBe(1);
  });

  test("公式ドメイン複数件で矛盾がない場合もAI由来なのでmedium上限のまま(キャップは迂回しない)", () => {
    const sources = [
      official(),
      official({ url: "https://www.tokyometro.jp/station/shinjuku/exit.html" }),
    ];
    const result = deriveSourceConfidence(sources);
    expect(result.level).toBe("medium");
    expect(result.sourceCount).toBe(2);
  });

  test("provenanceにsurveyedを指定すると複数の公式ソースでhighまで上がる", () => {
    const sources = [
      official(),
      official({ url: "https://www.tokyometro.jp/station/shinjuku/exit.html" }),
    ];
    const result = deriveSourceConfidence(sources, "surveyed");
    expect(result.level).toBe("high");
  });

  test("provenanceにsurveyedを指定しても公式ソース1件のみならmediumまで(独立した複数ソースでの裏付けがないため)", () => {
    const result = deriveSourceConfidence([official()], "surveyed");
    expect(result.level).toBe("medium");
  });

  test("同一ドメインの重複ページは独立した複数ソースとして数えない(surveyed指定でもmedium止まり)", () => {
    const sources = [
      official({ url: "https://www.jreast.co.jp/estation/stations/123.html" }),
      official({ url: "https://www.jreast.co.jp/estation/stations/123/exit.html" }),
    ];
    const result = deriveSourceConfidence(sources, "surveyed");
    expect(result.level).toBe("medium");
  });

  test("公式ドメインなしで有効な低スコアソースのみの場合はlowかそれ以下になる", () => {
    const neutral = scoreSearchSource(
      { url: "https://example.com/station-info", title: "駅の出口案内について", publishedAt: null },
      now
    );
    const result = deriveSourceConfidence([neutral]);
    expect(["low", "unavailable"]).toContain(result.level);
  });

  test("複数の独立ソースが裏付けている旨がreasonsに含まれる", () => {
    const sources = [
      official(),
      official({ url: "https://www.tokyometro.jp/station/shinjuku/exit.html" }),
    ];
    const result = deriveSourceConfidence(sources);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.includes("2件") || r.includes("複数"))).toBe(true);
  });

  test("AI由来のキャップにより丸められたことがreasonsからわかる", () => {
    const sources = [
      official(),
      official({ url: "https://www.tokyometro.jp/station/shinjuku/exit.html" }),
    ];
    const result = deriveSourceConfidence(sources, "ai_inferred");
    expect(result.reasons.some((r) => r.includes("AI推定") || r.includes("上限"))).toBe(true);
  });

  test("verifiedAtとexpiresAtは常にnull(スコアリングは実地検証ではないため)", () => {
    const result = deriveSourceConfidence([official()]);
    expect(result.verifiedAt).toBeNull();
    expect(result.expiresAt).toBeNull();
  });
});
