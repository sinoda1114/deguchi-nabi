import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";

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
