import type { Confidence, ConfidenceLevel } from "@/lib/domain/confidence";

const LEVEL_RANK: Record<ConfidenceLevel, number> = {
  unavailable: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * 複数の Confidence をまとめて「その区分の代表値」を出す。
 * 情報単位の評価方針(02_SPECIFICATION.md §8)を保つため、全体を一括評価する用途では使わない。
 */
export function worstConfidenceLevel(
  confidences: Confidence[]
): ConfidenceLevel {
  if (confidences.length === 0) return "unavailable";
  return confidences.reduce<ConfidenceLevel>((worst, c) => {
    return LEVEL_RANK[c.level] < LEVEL_RANK[worst] ? c.level : worst;
  }, "high");
}
