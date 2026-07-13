import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { OverviewStat } from "@/components/result/OverviewStat";
import { NOT_CONFIRMED, streetExitField } from "@/components/result/overview-field";

interface RouteExitStatProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * サマリーカードの出口(street_exit)欄。trainSegmentsPromise を待たず
 * facilitiesPromise だけで確定するため、独立したSuspense境界にして号車情報と
 * 足並みを揃えず表示できるようにする(体験改善のためのPromise粒度分割)。
 * 方角(destinationDirection)は出口名の代わりに使わない(ユーザーフィードバックに
 * 基づく設計変更。overview-field.ts参照)。
 */
export async function RouteExitStat({ facilitiesPromise }: RouteExitStatProps) {
  const facilitiesResult = await facilitiesPromise;
  const field = facilitiesResult.ok
    ? streetExitField(facilitiesResult.result.arrivalGuide)
    : { primary: NOT_CONFIRMED };

  return <OverviewStat icon="exit" label="利用出口" primary={field.primary} secondary={field.secondary} />;
}
