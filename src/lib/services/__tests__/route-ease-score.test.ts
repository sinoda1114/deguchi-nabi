import { describe, expect, test } from "vitest";
import { computeRouteEaseScore } from "../route-ease-score";
import type { RouteConfidenceSummary } from "@/lib/domain/route";

describe("computeRouteEaseScore", () => {
  test("全項目が高信頼度なら最高スコア(5)を返す", () => {
    const summary: RouteConfidenceSummary = {
      boardingPosition: "high",
      transferGuide: "high",
      gate: "high",
      exit: "high",
      accessibility: null,
    };
    expect(computeRouteEaseScore(summary)).toBe(5);
  });

  test("全項目が確認不能なら最低スコア(1)を返す", () => {
    const summary: RouteConfidenceSummary = {
      boardingPosition: "unavailable",
      transferGuide: "unavailable",
      gate: "unavailable",
      exit: "unavailable",
      accessibility: null,
    };
    expect(computeRouteEaseScore(summary)).toBe(1);
  });

  test("信頼度が混在する場合は平均を丸めたスコアを返す", () => {
    const summary: RouteConfidenceSummary = {
      boardingPosition: "high",
      transferGuide: "high",
      gate: "low",
      exit: "low",
      accessibility: null,
    };
    // (5+5+2+2)/4 = 3.5 → 四捨五入で4
    expect(computeRouteEaseScore(summary)).toBe(4);
  });

  test("accessibility(null)は集計対象から除外する", () => {
    const withAccessibility: RouteConfidenceSummary = {
      boardingPosition: "high",
      transferGuide: "high",
      gate: "high",
      exit: "high",
      accessibility: "unavailable",
    };
    const withoutAccessibility: RouteConfidenceSummary = {
      ...withAccessibility,
      accessibility: null,
    };
    // accessibility(unavailable=1)を含めると平均が下がるため、含む場合と含まない場合で結果が異なる
    expect(computeRouteEaseScore(withoutAccessibility)).toBe(5);
    expect(computeRouteEaseScore(withAccessibility)).toBeLessThan(5);
  });

  test("スコアは常に1〜5の整数に収まる", () => {
    const summary: RouteConfidenceSummary = {
      boardingPosition: "medium",
      transferGuide: "medium",
      gate: "medium",
      exit: "medium",
      accessibility: null,
    };
    const score = computeRouteEaseScore(summary);
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(5);
  });
});
