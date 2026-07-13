export type ConfidenceLevel = "high" | "medium" | "low" | "unavailable";

export interface Confidence {
  level: ConfidenceLevel;
  reasons: string[];
  verifiedAt: string | null;
  expiresAt: string | null;
  sourceCount: number;
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "高",
  medium: "中",
  low: "低",
  unavailable: "確認不能",
};

export function unavailableConfidence(reason: string): Confidence {
  return {
    level: "unavailable",
    reasons: [reason],
    verifiedAt: null,
    expiresAt: null,
    sourceCount: 0,
  };
}

export function lowConfidence(reason: string): Confidence {
  return {
    level: "low",
    reasons: [reason],
    verifiedAt: null,
    expiresAt: null,
    sourceCount: 0,
  };
}

/**
 * 情報の「出所」。信頼度(検証度)とは直交する軸として持つ(アーキテクチャ相談に基づく)。
 * 由来を confidence に混ぜず分離することで、「AI由来か」を正確に判定でき、
 * 表示ゲート(guide-step-visibility.ts)を由来×信頼度×ステップ種別で組める。
 */
export type Provenance = "surveyed" | "map_estimate" | "ai_inferred";

/**
 * 表示用ラベル。"surveyed"は「実際に現地を歩いて確認した」ケースだけでなく、
 * 駅の公式構内図・公式資料等の一次情報源で確認できたケースも含む(いずれも
 * AIの推測やGoogleマップ等の一般的な地図情報からの概算とは異なり、施設の
 * 実在・名称を裏付ける確度の高い根拠であるため)。"map_estimate"は、公式資料
 * による裏付けが無く、一般的な地図情報のみに基づく概算(AIレビュー指摘を受け、
 * 用語の混同を避けるためこのコメントを追記)。
 */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  surveyed: "現地調査済み",
  map_estimate: "地図で確認",
  ai_inferred: "AI推定",
};

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  unavailable: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * provenance(出所)に応じた confidence の上限。surveyed(現地調査済み)のみ
 * high まで許容し、map_estimate・ai_inferred は medium が上限(検索裏付けの
 * あるAI推定でもmediumまで、というアーキテクチャ相談の結論に基づく)。
 */
const CONFIDENCE_CAP_BY_PROVENANCE: Record<Provenance, ConfidenceLevel> = {
  surveyed: "high",
  map_estimate: "medium",
  ai_inferred: "medium",
};

/**
 * GuideStep生成側が、AI(Gemini)等の自己申告confidenceをそのまま採用しないための
 * ガード。モデル自身の確信度は参考値に留め、最終confidenceはこの関数を通した
 * 上限以下にする(docs/04 §Phase 2.5)。GuideStepを構築する箇所は、rawな
 * confidenceLevelを直接セットせず必ずこの関数を経由すること。
 */
export function capConfidenceForProvenance(
  level: ConfidenceLevel,
  provenance: Provenance
): ConfidenceLevel {
  const cap = CONFIDENCE_CAP_BY_PROVENANCE[provenance];
  return CONFIDENCE_RANK[level] > CONFIDENCE_RANK[cap] ? cap : level;
}
