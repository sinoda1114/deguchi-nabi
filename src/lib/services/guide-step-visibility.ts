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
 * 以前はconfidenceが"high"でない情報に「未確認情報」という注記を表示側
 * (overview-field.ts / route-timeline-nodes.ts / route-search.ts の
 * セグメントinstruction)で付与していたが、この注記テキスト自体は
 * ユーザーから不要と判断され削除した(2026-07-21)。「値自体は隠さず
 * 表示する」という本関数の判定方針(confidenceで隠すのはunavailableの
 * ときだけ)は変更していない。この関数はあくまで「表示するかどうか」
 * だけを判定し、確認度の見せ方には関与しない。
 */
export function isGuideStepVisible(step: Pick<GuideStep, "confidence">): boolean {
  return step.confidence.level !== "unavailable";
}
