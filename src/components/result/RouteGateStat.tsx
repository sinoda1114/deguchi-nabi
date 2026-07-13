import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { OverviewStat } from "@/components/result/OverviewStat";
import { NOT_CONFIRMED, ticketGateField } from "@/components/result/overview-field";

interface RouteGateStatProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * サマリーカードの改札(ticket_gate)欄。RouteExitStatと同じくfacilitiesPromise
 * だけで確定するため、独立したSuspense境界にする(体験改善のためのPromise粒度分割)。
 * 改札(ticket_gate)と出口(street_exit)は別項目として分離する
 * (ユーザーフィードバックに基づく設計変更。overview-field.ts参照)。
 */
export async function RouteGateStat({ facilitiesPromise }: RouteGateStatProps) {
  const facilitiesResult = await facilitiesPromise;
  const field = facilitiesResult.ok
    ? ticketGateField(facilitiesResult.result.arrivalGuide)
    : { primary: NOT_CONFIRMED };

  return <OverviewStat icon="gate" label="利用改札" primary={field.primary} secondary={field.secondary} />;
}
