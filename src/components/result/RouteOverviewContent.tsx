import { Suspense } from "react";
import type { RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { FacilityIcon } from "@/components/diagram/FacilityIcon";
import { RouteBoardingStat } from "@/components/result/RouteBoardingStat";
import { RouteBoardingStatSkeleton } from "@/components/result/RouteBoardingStatSkeleton";
import { RouteGateStat } from "@/components/result/RouteGateStat";
import { RouteGateStatSkeleton } from "@/components/result/RouteGateStatSkeleton";
import { RouteExitStat } from "@/components/result/RouteExitStat";
import { RouteExitStatSkeleton } from "@/components/result/RouteExitStatSkeleton";

interface RouteOverviewContentProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  transferCount: number;
}

/**
 * サマリーカードの中身(乗車位置・利用改札・利用出口・乗換回数)。
 * 「1号車前方」のような一番重要な情報が小さく埋もれていたとのフィードバックを
 * 受け、画面最上部で一番大きく表示する。改札(ticket_gate)と出口(street_exit)は
 * 別項目として分離し、方角は出口名の代わりに使わない(ユーザーフィードバックに
 * 基づく設計変更。overview-field.ts参照)。
 *
 * 乗車位置(train由来)・改札・出口(facilities由来)は互いに依存しないデータのため、
 * それぞれ独立したSuspense境界にする。facilities(改札・出口)はGemini呼び出しを
 * 含み遅くなりうるが、trainSegmentsが先に解決すれば乗車位置だけ先に表示できる
 * (「検索結果が一括表示されて固まって見える」というユーザーフィードバックに基づく、
 * Promise粒度をセクション単位からデータ単位へ分割する改修)。
 */
export function RouteOverviewContent({
  trainSegmentsPromise,
  facilitiesPromise,
  transferCount,
}: RouteOverviewContentProps) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      <Suspense fallback={<RouteBoardingStatSkeleton />}>
        <RouteBoardingStat trainSegmentsPromise={trainSegmentsPromise} />
      </Suspense>
      <Suspense fallback={<RouteGateStatSkeleton />}>
        <RouteGateStat facilitiesPromise={facilitiesPromise} />
      </Suspense>
      <Suspense fallback={<RouteExitStatSkeleton />}>
        <RouteExitStat facilitiesPromise={facilitiesPromise} />
      </Suspense>
      <div className="col-span-3 flex items-center gap-1.5 text-sm font-semibold">
        <FacilityIcon type="passage" className="h-4 w-4" />
        乗換{transferCount}回
      </div>
    </div>
  );
}
