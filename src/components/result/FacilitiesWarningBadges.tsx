import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { WarningBadge } from "@/components/diagram/WarningBadge";

interface FacilitiesWarningBadgesProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * 出口・改札が方角のみの案内(hasApproximateGuidance)になった場合のみ、
 * ページ全体で1回だけ注記を出す。各segmentのinstructionで同じ注意書きを
 * 繰り返すと、機能不全に見え信頼を損ねるとのフィードバックを受けて
 * こちらに集約した(route-search.ts の hasApproximateGuidance 参照)。
 */
export async function FacilitiesWarningBadges({
  facilitiesPromise,
}: FacilitiesWarningBadgesProps) {
  const facilitiesResult = await facilitiesPromise;

  if (!facilitiesResult.ok || !facilitiesResult.result.hasApproximateGuidance) {
    return <></>;
  }

  return (
    <WarningBadge text="出口・改札の一部は方角のみの案内です。現地の案内表示もあわせてご確認ください。" />
  );
}
