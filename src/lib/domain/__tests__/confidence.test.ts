import { describe, expect, test } from "vitest";
import { capConfidenceForProvenance } from "@/lib/domain/confidence";
import type { ConfidenceLevel, Provenance } from "@/lib/domain/confidence";

describe("capConfidenceForProvenance", () => {
  test("surveyed(現地調査済み)は high を上限までそのまま許容する", () => {
    expect(capConfidenceForProvenance("high", "surveyed")).toBe("high");
    expect(capConfidenceForProvenance("medium", "surveyed")).toBe("medium");
  });

  test("ai_inferred(AI推定)は自己申告が high でも medium に格下げする(検索裏付けありでも medium が上限)", () => {
    expect(capConfidenceForProvenance("high", "ai_inferred")).toBe("medium");
  });

  test("ai_inferred は medium 以下ならそのまま通す", () => {
    expect(capConfidenceForProvenance("medium", "ai_inferred")).toBe("medium");
    expect(capConfidenceForProvenance("low", "ai_inferred")).toBe("low");
    expect(capConfidenceForProvenance("unavailable", "ai_inferred")).toBe("unavailable");
  });

  test("map_estimate(地図で確認)も medium が上限(桜丘口の既存扱いと同じ基準)", () => {
    expect(capConfidenceForProvenance("high", "map_estimate")).toBe("medium");
    expect(capConfidenceForProvenance("low", "map_estimate")).toBe("low");
  });

  test.each<[ConfidenceLevel, Provenance]>([
    ["high", "ai_inferred"],
    ["high", "map_estimate"],
    ["medium", "surveyed"],
  ])("戻り値は常に元のconfidence以下(格上げはしない): %s / %s", (level, provenance) => {
    const rank: Record<ConfidenceLevel, number> = { unavailable: 0, low: 1, medium: 2, high: 3 };
    const capped = capConfidenceForProvenance(level, provenance);
    expect(rank[capped]).toBeLessThanOrEqual(rank[level]);
  });
});
