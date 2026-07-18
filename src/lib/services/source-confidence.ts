import {
  capConfidenceForProvenance,
  unavailableConfidence,
  PROVENANCE_LABEL,
  type Confidence,
  type ConfidenceLevel,
  type Provenance,
} from "@/lib/domain/confidence";
import type { ScoredSearchSource } from "@/lib/services/source-scoring";

/**
 * source-scoring.ts でスコア済みの検索結果から、既存の Confidence 型に沿った
 * 確信度を導出する。「複数の独立ソースが同じ事実を裏付けている場合は確信度を
 * 上げる材料にする」「AIを事実の唯一の生成元にしない」という設計原則を反映する。
 *
 * 重要: このモジュールは capConfidenceForProvenance によるキャップを迂回しない。
 * provenance の既定値は "ai_inferred"(検索結果はAIが取得・要約したものである
 * 前提)であり、公式ドメインが何件裏付けても最終的にはmedium以下に丸められる。
 * 現地調査等で由来が確定している場合のみ、呼び出し側が明示的に別の provenance
 * (例: "surveyed")を渡すこと。
 */

/** スコアが0以下の候補は「有効なソース」とみなさない(低品質判定含む)。 */
const MIN_VALID_SCORE = 0;

/** 独立した公式ソースが2件以上あれば「矛盾なく裏付けられた」とみなす。 */
const MULTI_SOURCE_THRESHOLD = 2;

function determineRawLevel(officialSourceCount: number): ConfidenceLevel {
  if (officialSourceCount >= MULTI_SOURCE_THRESHOLD) return "high";
  if (officialSourceCount === 1) return "medium";
  return "low";
}

function buildReasons(
  validSources: ScoredSearchSource[],
  officialSources: ScoredSearchSource[],
  rawLevel: ConfidenceLevel,
  cappedLevel: ConfidenceLevel,
  provenance: Provenance
): string[] {
  const reasons: string[] = [];

  if (officialSources.length >= MULTI_SOURCE_THRESHOLD) {
    reasons.push(
      `公式ドメインの情報源が${officialSources.length}件見つかり、複数の独立ソースで裏付けられている`
    );
  } else if (officialSources.length === 1) {
    reasons.push("公式ドメインの情報源が1件見つかった(裏付けは単一ソースのみ)");
  } else {
    reasons.push(`公式ドメインの情報源はなく、有効な情報源${validSources.length}件のみ`);
  }

  if (cappedLevel !== rawLevel) {
    reasons.push(
      `provenance「${PROVENANCE_LABEL[provenance]}」の上限によりconfidenceは${rawLevel}から${cappedLevel}に丸められた(AI推定・地図概算はmediumが上限)`
    );
  }

  return reasons;
}

/**
 * スコア済み検索結果の配列から Confidence を導出する。
 * - 候補が0件、または有効なソース(score > 0)が0件の場合は unavailable を返す。
 * - 公式ドメインが1件のみなら medium、2件以上で矛盾なく裏付けられていれば high
 *   を仮の確信度とし、最後に capConfidenceForProvenance で provenance 上限を適用する。
 */
export function deriveSourceConfidence(
  scoredSources: ScoredSearchSource[],
  provenance: Provenance = "ai_inferred"
): Confidence {
  if (scoredSources.length === 0) {
    return unavailableConfidence("検索結果が0件のため確認できない");
  }

  const validSources = scoredSources.filter((source) => source.score > MIN_VALID_SCORE);
  if (validSources.length === 0) {
    return unavailableConfidence("有効な情報源が見つからなかった(低品質な情報源のみ)");
  }

  const officialSources = validSources.filter((source) => source.isOfficialDomain);
  const rawLevel = determineRawLevel(officialSources.length);
  const cappedLevel = capConfidenceForProvenance(rawLevel, provenance);

  return {
    level: cappedLevel,
    reasons: buildReasons(validSources, officialSources, rawLevel, cappedLevel, provenance),
    verifiedAt: null,
    expiresAt: null,
    sourceCount: validSources.length,
  };
}
