import type { ArrivalGuide } from "@/lib/domain/route";

export const NOT_CONFIRMED = "確認できません";

export interface OverviewField {
  primary: string;
  secondary?: string;
}

/**
 * 改札名(ticket_gate)を取得する。確認できていない場合は推測せず明示する。
 * 改札が実在確認できている(step != null)場合は、confidence(検証度)に関わらず
 * 必ず改札名を表示する(「確認できませんだらけになる」問題への対応として
 * 導入した設計。値自体は隠さない)。以前はconfidenceが"high"未満の場合に
 * secondaryへ「未確認情報」の注記を付けていたが、この付記自体はユーザーから
 * 不要と判断され削除した。
 */
export function ticketGateField(arrivalGuide: ArrivalGuide): OverviewField {
  const step = arrivalGuide.steps.find((s) => s.type === "ticket_gate");
  if (!step) return { primary: NOT_CONFIRMED };
  return { primary: step.title, secondary: undefined };
}

/**
 * 出口名(street_exit)を取得する。方角(destinationDirection)は出口名の
 * 代わりに使わない。具体的な出口が確認できていない場合、方角が判明していれば
 * 「推奨方向: ◯◯側」として区別できる形で補足する。
 *
 * 出口が実在確認できている(step != null)場合は、confidence(検証度)に関わらず
 * 必ず出口名を表示する(値自体は隠さない、ticketGateFieldと同じ方針)。
 */
export function streetExitField(arrivalGuide: ArrivalGuide): OverviewField {
  const step = arrivalGuide.steps.find((s) => s.type === "street_exit");
  if (step) {
    return { primary: step.title, secondary: undefined };
  }
  return {
    primary: NOT_CONFIRMED,
    secondary: arrivalGuide.destinationDirection
      ? `推奨方向: ${arrivalGuide.destinationDirection}側`
      : undefined,
  };
}
