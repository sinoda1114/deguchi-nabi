import type { ArrivalGuide } from "@/lib/domain/route";

export const NOT_CONFIRMED = "確認できません";
/**
 * confidenceが"high"でない改札・出口ステップに付ける注記。低リスク種別
 * (ticket_gate)であってもconfidence:lowで表示されうるため
 * (guide-step-visibility.ts参照)、見た目だけでは調査済み情報と区別が
 * つかなくなる問題があった(AIレビュー指摘)。
 */
export const UNCERTAIN_NOTE = "未確認情報";

export interface OverviewField {
  primary: string;
  secondary?: string;
}

/** 改札名(ticket_gate)を取得する。確認できていない場合は推測せず明示する。 */
export function ticketGateField(arrivalGuide: ArrivalGuide): OverviewField {
  const step = arrivalGuide.steps.find((s) => s.type === "ticket_gate");
  if (!step) return { primary: NOT_CONFIRMED };
  return { primary: step.title, secondary: step.confidence.level === "high" ? undefined : UNCERTAIN_NOTE };
}

/**
 * 出口名(street_exit)を取得する。方角(destinationDirection)は出口名の
 * 代わりに使わない。具体的な出口が確認できていない場合、方角が判明していれば
 * 「推奨方向: ◯◯側」として区別できる形で補足する。
 */
export function streetExitField(arrivalGuide: ArrivalGuide): OverviewField {
  const step = arrivalGuide.steps.find((s) => s.type === "street_exit");
  if (step) {
    return { primary: step.title, secondary: step.confidence.level === "high" ? undefined : UNCERTAIN_NOTE };
  }
  return {
    primary: NOT_CONFIRMED,
    secondary: arrivalGuide.destinationDirection
      ? `推奨方向: ${arrivalGuide.destinationDirection}側`
      : undefined,
  };
}
