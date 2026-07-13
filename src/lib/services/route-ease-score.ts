import type { RouteConfidenceSummary } from "@/lib/domain/route";
import type { ConfidenceLevel } from "@/lib/domain/confidence";

const EASE_SCORE_BY_LEVEL: Record<ConfidenceLevel, number> = {
  high: 5,
  medium: 3,
  low: 2,
  unavailable: 1,
};

/**
 * 経路案内の「迷いやすさ」を1〜5の整数スコアで表す(高いほど迷いにくい)。
 * confidenceSummaryの各項目(乗車位置・乗換導線・改札・出口・バリアフリー)の
 * 信頼度レベルを単純平均し、四捨五入した値を返す。歩きながら3秒で理解できる
 * ことを優先するUI向けの簡易指標であり、確率的な正確さは意図していない。
 */
export function computeRouteEaseScore(summary: RouteConfidenceSummary): number {
  const levels = [
    summary.boardingPosition,
    summary.transferGuide,
    summary.gate,
    summary.exit,
    summary.accessibility,
  ].filter((level): level is ConfidenceLevel => level != null);

  if (levels.length === 0) return 1;

  const total = levels.reduce((sum, level) => sum + EASE_SCORE_BY_LEVEL[level], 0);
  return Math.round(total / levels.length);
}
