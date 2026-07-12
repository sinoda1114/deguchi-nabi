import type { FacilitiesSearchResult } from "@/lib/services/route-search";

interface RecommendedExitValueProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * RouteSummaryCard の「推奨出口」行に埋め込むインライン値。
 */
export async function RecommendedExitValue({ facilitiesPromise }: RecommendedExitValueProps) {
  const facilitiesResult = await facilitiesPromise;

  if (!facilitiesResult.ok) {
    return <>確認できません</>;
  }

  return <>{facilitiesResult.result.recommendedExit}</>;
}
