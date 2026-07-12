import type { RouteSegment } from "@/lib/domain/route";
import { RouteSegmentListItem } from "./RouteSegmentListItem";

interface RouteTimelineProps {
  segments: RouteSegment[];
}

/**
 * STEP番号は CSS counter で採番する(RouteSegmentListItem 参照)。
 * このコンポーネント単体で完結する場合は counter-reset をこの <ol> 自身に持たせる。
 */
export function RouteTimeline({ segments }: RouteTimelineProps) {
  return (
    <ol className="route-steps-container flex flex-col gap-3">
      {segments.map((segment, i) => (
        <RouteSegmentListItem key={i} segment={segment} />
      ))}
    </ol>
  );
}
