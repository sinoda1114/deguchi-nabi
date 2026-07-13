import { Suspense } from "react";
import type { RouteMode, RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { FacilityIcon } from "@/components/diagram/FacilityIcon";
import { RouteBoardingStat } from "@/components/result/RouteBoardingStat";
import { RouteBoardingStatSkeleton } from "@/components/result/RouteBoardingStatSkeleton";
import { RouteExitStat } from "@/components/result/RouteExitStat";
import { RouteExitStatSkeleton } from "@/components/result/RouteExitStatSkeleton";
import { RouteEaseScoreStat } from "@/components/result/RouteEaseScoreStat";
import { RouteEaseScoreStatSkeleton } from "@/components/result/RouteEaseScoreStatSkeleton";

interface RouteOverviewContentProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  mode: RouteMode;
  transferCount: number;
}

/**
 * サマリーカードの中身(号車・出口・乗換回数・迷いにくさ)。
 * 「1号車前方」のような一番重要な情報が小さく埋もれていたとのフィードバックを
 * 受け、画面最上部で一番大きく表示する。
 *
 * 号車(train由来)・出口(facilities由来)は互いに依存しないデータのため、
 * それぞれ独立したSuspense境界にする。facilities(改札・出口)はGemini呼び出しを
 * 含み遅くなりうるが、trainSegmentsが先に解決すれば号車情報だけ先に表示できる
 * (「検索結果が一括表示されて固まって見える」というユーザーフィードバックに基づく、
 * Promise粒度をセクション単位からデータ単位へ分割する改修)。
 */
export function RouteOverviewContent({
  trainSegmentsPromise,
  facilitiesPromise,
  mode,
  transferCount,
}: RouteOverviewContentProps) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <Suspense fallback={<RouteBoardingStatSkeleton />}>
        <RouteBoardingStat trainSegmentsPromise={trainSegmentsPromise} />
      </Suspense>
      <Suspense fallback={<RouteExitStatSkeleton />}>
        <RouteExitStat facilitiesPromise={facilitiesPromise} />
      </Suspense>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <FacilityIcon type="passage" className="h-4 w-4" />
        乗換{transferCount}回
      </div>
      <Suspense fallback={<RouteEaseScoreStatSkeleton />}>
        <RouteEaseScoreStat
          trainSegmentsPromise={trainSegmentsPromise}
          facilitiesPromise={facilitiesPromise}
          mode={mode}
        />
      </Suspense>
    </div>
  );
}
