import {
  capConfidenceForProvenance,
  unavailableConfidence,
  PROVENANCE_LABEL,
  type Confidence,
  type ConfidenceLevel,
  type Provenance,
} from "@/lib/domain/confidence";
import { extractHostname, type ScoredSearchSource } from "@/lib/services/source-scoring";

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

/** 独立した公式ドメインが2件以上あれば「矛盾なく裏付けられた」とみなす。 */
const MULTI_SOURCE_THRESHOLD = 2;

/**
 * 公式ソースのURLから一意なホスト名の集合を数える。同一ドメインの重複ページ
 * (例: 同じ駅公式サイト内の別ページ2件)を、独立した2ソースとして誤って
 * 「矛盾なく裏付けられた」扱いしないための独立性判定。
 */
function countUniqueOfficialDomains(officialSources: ScoredSearchSource[]): number {
  const hostnames = new Set(
    officialSources
      .map((source) => extractHostname(source.candidate.url))
      .filter((hostname) => hostname !== "")
  );
  return hostnames.size;
}

function determineRawLevel(uniqueOfficialDomainCount: number): ConfidenceLevel {
  if (uniqueOfficialDomainCount >= MULTI_SOURCE_THRESHOLD) return "high";
  if (uniqueOfficialDomainCount === 1) return "medium";
  return "low";
}

function buildReasons(
  validSources: ScoredSearchSource[],
  officialSources: ScoredSearchSource[],
  uniqueOfficialDomainCount: number,
  rawLevel: ConfidenceLevel,
  cappedLevel: ConfidenceLevel,
  provenance: Provenance
): string[] {
  const reasons: string[] = [];

  if (uniqueOfficialDomainCount >= MULTI_SOURCE_THRESHOLD) {
    reasons.push(
      `独立した公式ドメインが${uniqueOfficialDomainCount}件見つかり、複数の独立ソースで裏付けられている`
    );
  } else if (uniqueOfficialDomainCount === 1) {
    reasons.push(
      officialSources.length > 1
        ? "公式ドメインの情報源はあるが同一ドメイン内のみで、独立した複数ソースでの裏付けではない"
        : "公式ドメインの情報源が1件見つかった(裏付けは単一ソースのみ)"
    );
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
  const uniqueOfficialDomainCount = countUniqueOfficialDomains(officialSources);
  const rawLevel = determineRawLevel(uniqueOfficialDomainCount);
  const cappedLevel = capConfidenceForProvenance(rawLevel, provenance);

  return {
    level: cappedLevel,
    reasons: buildReasons(
      validSources,
      officialSources,
      uniqueOfficialDomainCount,
      rawLevel,
      cappedLevel,
      provenance
    ),
    verifiedAt: null,
    expiresAt: null,
    sourceCount: validSources.length,
  };
}
