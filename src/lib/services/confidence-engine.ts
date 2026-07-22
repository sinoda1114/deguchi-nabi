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

/**
 * 改札・出口が複数候補(alternatives)の場合に、候補群全体を代表する1つの
 * Confidenceを組み立てる。候補が1件ならそのまま返す(単一断定と同じ扱い)。
 * 複数件の場合はworstConfidenceLevelで最も慎重な水準を採用し、reasonsに
 * その旨を明記する(個々の候補のconfidence自体は失わず、セグメント単位の
 * 代表値としてのみ使う)。
 */
export function combinedFacilityConfidence(confidences: Confidence[]): Confidence {
  if (confidences.length === 1) return confidences[0];
  return {
    level: worstConfidenceLevel(confidences),
    reasons: ["複数候補があるため、個々の検証度のうち最も慎重な値を採用しています。"],
    verifiedAt: null,
    expiresAt: null,
    sourceCount: 0,
  };
}
