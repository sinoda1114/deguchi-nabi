import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { WarningBadge } from "@/components/diagram/WarningBadge";

interface FacilitiesWarningBadgesProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * 出口・改札が方角のみの案内(hasApproximateGuidance)、または複数候補の案内
 * (hasAlternativesGuidance、2026-07-22追加)になった場合のみ、ページ全体で
 * 1回だけ注記を出す。各segmentのinstructionで同じ注意書きを繰り返すと、
 * 機能不全に見え信頼を損ねるとのフィードバックを受けてこちらに集約した
 * (route-search.ts の hasApproximateGuidance 参照)。両者は排他(unified経路
 * のみalternativesになりうり、その経路ではapproximateにならない)だが、
 * 将来の分岐追加に備え独立した条件として扱う。
 */
export async function FacilitiesWarningBadges({
  facilitiesPromise,
}: FacilitiesWarningBadgesProps) {
  const facilitiesResult = await facilitiesPromise;

  if (!facilitiesResult.ok) {
    return <></>;
  }

  return (
    <>
      {facilitiesResult.result.hasApproximateGuidance && (
        <WarningBadge text="出口・改札の一部は方角のみの案内です。現地の案内表示もあわせてご確認ください。" />
      )}
      {facilitiesResult.result.hasAlternativesGuidance && (
        <WarningBadge text="改札・出口に複数の候補があります。現地の案内表示でご確認ください。" />
      )}
    </>
  );
}
