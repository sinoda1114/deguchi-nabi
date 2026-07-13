import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { OverviewStat } from "@/components/result/OverviewStat";

interface RouteExitStatProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * サマリーカードの出口欄。trainSegmentsPromise を待たず facilitiesPromise だけで
 * 確定するため、独立したSuspense境界にして号車情報と足並みを揃えず表示できる
 * ようにする(体験改善のためのPromise粒度分割)。
 */
export async function RouteExitStat({ facilitiesPromise }: RouteExitStatProps) {
  const facilitiesResult = await facilitiesPromise;

  return (
    <OverviewStat
      icon="exit"
      primary={facilitiesResult.ok ? facilitiesResult.result.recommendedExit : "確認できません"}
    />
  );
}
