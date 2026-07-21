import type { GuideStep, GuideStepType } from "@/lib/domain/route";
import type { ConfidenceLevel } from "@/lib/domain/confidence";

type RiskTier = "high_risk" | "low_risk";

/**
 * 各ステップ種別のリスク階層。改札後の進行方向・自由通路・地下街・地上出口は
 * 逆方向へ数百メートル誘導する等の実害があるため高リスクとする
 * (アーキテクチャ相談に基づく設計。docs/04 §Phase 2.5)。
 *
 * Record<GuideStepType, RiskTier> として全種別を網羅させているのは意図的:
 * 将来 GuideStepType へ新しい種別を追加した際、ここへの追加を忘れると
 * TypeScriptがコンパイルエラーにする。未分類のまま「低リスク扱い(=低い
 * confidenceでも表示)」に倒れるfail-openを避けるため(AIレビュー指摘)。
 */
const STEP_RISK_TIER: Record<GuideStepType, RiskTier> = {
  boarding: "low_risk",
  alighting: "low_risk",
  platform_facility: "low_risk",
  ticket_gate: "low_risk",
  post_gate_direction: "high_risk",
  public_passage: "high_risk",
  underground_mall: "high_risk",
  street_exit: "high_risk",
  destination_direction: "low_risk",
};

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  unavailable: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const MIN_CONFIDENCE_RANK_BY_RISK_TIER: Record<RiskTier, number> = {
  high_risk: CONFIDENCE_RANK.medium,
  low_risk: CONFIDENCE_RANK.low,
};

/**
 * GuideStepをユーザーに表示してよいかを、信頼度(検証度)とステップ種別のリスクから判定する。
 *
 * - unavailable: どの種別でも非表示(根拠のない詳細を捏造しないため)
 * - 高リスク種別(改札後方向・自由通路・地下街・地上出口): medium以上でのみ表示
 * - 低リスク種別(乗車・降車・ホーム設備・改札・方角案内): low でも表示
 *
 * confidenceがAI自己申告のまま渡されることを前提にしない: GuideStep生成側は
 * capConfidenceForProvenance(confidence.ts)でprovenanceに応じた上限を適用した
 * 後のconfidenceをここに渡す責務を持つ。
 *
 * 引数はGuideStep全体ではなく type/confidence のみのPickにしている
 * (route-search.ts側でStationFacility由来の出口情報を判定する際、GuideStepの
 * 他フィールド(title/instruction/landmarks/provenance)を持たない疑似オブジェクトを
 * 組み立てて渡せるようにするため。判定ロジック自体はtype/confidenceしか
 * 参照しないため、シグネチャを狭めるだけで挙動は変わらない)。
 */
export function isGuideStepVisible(step: Pick<GuideStep, "type" | "confidence">): boolean {
  if (step.confidence.level === "unavailable") return false;

  const tier = STEP_RISK_TIER[step.type];
  return CONFIDENCE_RANK[step.confidence.level] >= MIN_CONFIDENCE_RANK_BY_RISK_TIER[tier];
}
