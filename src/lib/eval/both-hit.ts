import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";

/**
 * 製品の合格線: ユーザーに改札名と出口名の両方が出ている。
 * 片方だけの confirmed / unavailable は不合格。
 * PR #133 Option A(gate-only成功化)は採用しない。
 */
export function isScoringBothHit<F extends { name: string }>(
  rec: FacilityRecommendation<F>
): boolean {
  if (rec.state === "confirmed") {
    return rec.pair.gate !== null && rec.pair.exit !== null;
  }
  if (rec.state === "alternatives") {
    return rec.pairs.some((pair) => pair.gate !== null && pair.exit !== null);
  }
  return false;
}
