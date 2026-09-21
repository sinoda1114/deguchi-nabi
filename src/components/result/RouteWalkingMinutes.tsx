import type { Coordinates } from "@/lib/domain/station";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import {
  estimateWalkingMinutesFromOrigin,
  walkingOriginFromGuide,
} from "@/lib/services/walking-estimate";
import { WalkingMinutesLine } from "@/components/result/WalkingMinutesLine";

interface RouteWalkingMinutesProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  stationCoordinates: Coordinates | null;
  destinationCoordinates: Coordinates | null;
  estimatedDurationMinutes: number | null;
  arrivalStationName: string;
}

/**
 * 確定した案内に出口/改札座標があればそれを起点にし、無ければ駅代表座標に落とす。
 * 施設解決を待つ。フォールバックは呼び出し側の Suspense が駅代表の概算を出す。
 */
export async function RouteWalkingMinutes({
  facilitiesPromise,
  stationCoordinates,
  destinationCoordinates,
  estimatedDurationMinutes,
  arrivalStationName,
}: RouteWalkingMinutesProps) {
  const facilitiesResult = await facilitiesPromise;
  const recommendation = facilitiesResult.ok
    ? facilitiesResult.result.arrivalGuide.facility
    : null;
  const origin = walkingOriginFromGuide({
    recommendation,
    stationCoordinates,
    stationName: arrivalStationName,
  });
  const estimate = estimateWalkingMinutesFromOrigin(origin, destinationCoordinates);
  if (!estimate) return null;
  return (
    <WalkingMinutesLine
      estimatedDurationMinutes={estimatedDurationMinutes}
      walkingMinutes={estimate.minutes}
      originKind={estimate.originKind}
    />
  );
}
