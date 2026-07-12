import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { RouteSegmentListItem } from "@/components/timeline/RouteSegmentListItem";

interface TransferExitSegmentListProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * 到着駅の乗換(改札)・出口セグメントを表示する Server Component。
 * facilitiesPromise は TrainSegmentList とは独立して解決するため、
 * 経路(train区間)が先に確定していても facilities の解決に時間がかかる場合は
 * このセクションだけ遅れて表示される。
 */
export async function TransferExitSegmentList({
  facilitiesPromise,
}: TransferExitSegmentListProps) {
  const facilitiesResult = await facilitiesPromise;

  if (!facilitiesResult.ok) {
    return (
      <p className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm font-semibold text-[var(--foreground-muted)]">
        {facilitiesResult.reason}
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      <RouteSegmentListItem segment={facilitiesResult.result.transferSegment} />
      <RouteSegmentListItem segment={facilitiesResult.result.exitSegment} />
    </ol>
  );
}
