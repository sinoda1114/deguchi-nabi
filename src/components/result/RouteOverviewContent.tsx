import type { RouteMode, RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { computeConfidenceSummary } from "@/lib/services/route-search";
import { computeRouteEaseScore } from "@/lib/services/route-ease-score";
import { FacilityIcon } from "@/components/diagram/FacilityIcon";
import { EaseScoreStars } from "@/components/confidence/EaseScoreStars";

interface RouteOverviewContentProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  mode: RouteMode;
  transferCount: number;
}

function OverviewStat({
  icon,
  primary,
  secondary,
}: {
  icon: "car" | "exit";
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] bg-black/10 p-3">
      <FacilityIcon type={icon} className="h-4 w-4 opacity-80" />
      <p className="mt-1 text-xl font-black leading-none">{primary}</p>
      {secondary ? <p className="mt-0.5 text-xs opacity-80">{secondary}</p> : null}
    </div>
  );
}

/**
 * サマリーカードの中身(号車・出口・乗換回数・迷いにくさ)。
 * 「1号車前方」のような一番重要な情報が小さく埋もれていたとのフィードバックを
 * 受け、画面最上部で一番大きく表示する。
 *
 * facilities(改札・出口)の解決が失敗しても、号車情報と乗換回数は
 * trainSegments/props由来で独立に確定しているため表示を続ける
 * (出口だけの部分障害でカード全体が空になる可用性の後退を避けるため。
 * AIレビュー指摘に基づく修正)。
 */
export async function RouteOverviewContent({
  trainSegmentsPromise,
  facilitiesPromise,
  mode,
  transferCount,
}: RouteOverviewContentProps) {
  const [trainSegments, facilitiesResult] = await Promise.all([
    trainSegmentsPromise,
    facilitiesPromise,
  ]);

  const firstBoarding = trainSegments.find((s) => s.boardingPosition)?.boardingPosition ?? null;

  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <OverviewStat
        icon="car"
        primary={firstBoarding ? `${firstBoarding.carNumber}号車` : "確認できません"}
        secondary={firstBoarding?.doorPosition}
      />
      <OverviewStat
        icon="exit"
        primary={facilitiesResult.ok ? facilitiesResult.result.recommendedExit : "確認できません"}
      />
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <FacilityIcon type="passage" className="h-4 w-4" />
        乗換{transferCount}回
      </div>
      {facilitiesResult.ok ? (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold opacity-80">迷いにくさ</span>
          <EaseScoreStars
            score={computeRouteEaseScore(
              computeConfidenceSummary(trainSegments, facilitiesResult.result, mode)
            )}
          />
        </div>
      ) : (
        <p className="text-xs font-semibold opacity-90">{facilitiesResult.reason}</p>
      )}
    </div>
  );
}
