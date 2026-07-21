import type { GuideStep } from "@/lib/domain/route";

/**
 * GuideStepをユーザーに表示してよいかを判定する。
 *
 * 判定基準は「AIが情報自体を一切返せなかったか」の一点のみ:
 * confidence.level === "unavailable"(実在確認すらできていない)のときだけ
 * 非表示にする。それ以外(low/medium/high)はステップ種別に関わらず必ず表示する。
 *
 * 以前はステップ種別ごとにリスク階層(改札後方向・自由通路・地下街・出口を
 * "高リスク"とし、confidence medium未満なら非表示)を設けていたが、これが
 * 原因で改札・出口情報の大半が「確認できません」表示になり、実機検証で
 * ユーザーから強い不満が出た。第三者レビューの結論は以下の通り:
 *
 * 1. confidenceはAIの自己申告であり較正されていない。ハードな表示ゲートに
 *    使うべきではない
 * 2. 「隠す」のではなく「存在する情報は必ず出す、確度が高くなければ参考情報
 *    である旨をバッジ/注記で伝える」に転換すべき
 *
 * confidenceが"high"でない情報への注記("未確認情報")は、表示側
 * (overview-field.ts の UNCERTAIN_NOTE、route-timeline-nodes.ts の
 * UNCERTAIN_STEP_NOTE、route-search.ts のセグメントinstruction)がそれぞれ
 * 付与する。この関数はあくまで「表示するかどうか」だけを判定し、確認度の
 * 見せ方には関与しない。
 */
export function isGuideStepVisible(step: Pick<GuideStep, "confidence">): boolean {
  return step.confidence.level !== "unavailable";
}
