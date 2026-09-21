import type { ReactNode } from "react";
import type { WalkingOriginKind } from "@/lib/services/walking-estimate";

export function walkingOriginPhrase(kind: WalkingOriginKind): string {
  switch (kind) {
    case "exit":
      return "出口からの";
    case "gate":
      return "改札からの";
    case "station":
      return "到着駅からの";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

interface WalkingMinutesLineProps {
  estimatedDurationMinutes: number | null;
  walkingMinutes: number | null;
  originKind: WalkingOriginKind;
}

/**
 * 乗車+徒歩の合計目安。徒歩は直線×道なり係数の概算なので「目安」と明記する。
 * 起点は出口/改札/駅代表のいずれか。出口からの距離であるかのように誤認させない。
 */
export function WalkingMinutesLine({
  estimatedDurationMinutes,
  walkingMinutes,
  originKind,
}: WalkingMinutesLineProps): ReactNode {
  if (estimatedDurationMinutes == null || walkingMinutes == null) return null;
  const totalMinutes = estimatedDurationMinutes + walkingMinutes;
  return (
    <p className="mt-0.5 text-xs opacity-70">
      目的地到着まで目安約{totalMinutes}分(乗車約{estimatedDurationMinutes}分+
      {walkingOriginPhrase(originKind)}徒歩目安約{walkingMinutes}分)
    </p>
  );
}
