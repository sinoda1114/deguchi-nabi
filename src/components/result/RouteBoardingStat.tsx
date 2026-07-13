import type { RouteSegment } from "@/lib/domain/route";
import { OverviewStat } from "@/components/result/OverviewStat";

interface RouteBoardingStatProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
}

/**
 * サマリーカードの号車欄。facilities(改札・出口、Gemini呼び出しを含み遅くなりうる)
 * を待たず trainSegmentsPromise だけで確定するため、独立したSuspense境界にして
 * 出口情報より先に表示できるようにする(体験改善のためのPromise粒度分割)。
 */
export async function RouteBoardingStat({ trainSegmentsPromise }: RouteBoardingStatProps) {
  const trainSegments = await trainSegmentsPromise;
  const firstBoarding = trainSegments.find((s) => s.boardingPosition)?.boardingPosition ?? null;

  return (
    <OverviewStat
      icon="car"
      label="乗車位置"
      primary={firstBoarding ? `${firstBoarding.carNumber}号車` : "確認できません"}
      secondary={firstBoarding?.doorPosition}
    />
  );
}
