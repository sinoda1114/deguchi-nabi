import type { RouteSegment } from "@/lib/domain/route";
import { StationNode } from "./StationNode";
import { DirectionArrow } from "./DirectionArrow";
import { FacilityIcon } from "./FacilityIcon";
import { WarningBadge } from "./WarningBadge";
import { SegmentDetailToggle } from "./SegmentDetailToggle";
import { ConfidenceBadge } from "@/components/confidence/ConfidenceBadge";

interface RouteDiagramProps {
  segments: RouteSegment[];
}

/**
 * 検索ごとの画像生成はせず、構造化データから軽量な HTML/CSS で描画する
 * (02_SPECIFICATION.md §7)。実際の構内図は再現せず、主要導線だけを示す。
 */
export function RouteDiagram({ segments }: RouteDiagramProps) {
  return (
    <div aria-label="ルートの簡易図" className="flex flex-col">
      {segments.map((segment, i) => (
        <div key={i}>
          {i > 0 ? <DirectionArrow /> : null}
          <StationNode name={segment.from}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--foreground-muted)]">
              {segment.boardingPosition ? (
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--accent)]">
                  <FacilityIcon type="car" className="h-4 w-4" />
                  {segment.boardingPosition.carNumber}号車・{segment.boardingPosition.doorPosition}
                </span>
              ) : null}
              {segment.line ? <span>{segment.line}</span> : null}
              {segment.direction ? <span>{segment.direction}</span> : null}
              {segment.facilities.map((facility, fi) => (
                <span key={fi} className="inline-flex items-center gap-1">
                  <FacilityIcon type={facility.facilityType} className="h-4 w-4" />
                  {facility.name}
                </span>
              ))}
            </div>
            <div className="mt-1.5">
              <ConfidenceBadge level={segment.confidence.level} size="sm" />
            </div>
            {segment.warnings.map((w, wi) => (
              <WarningBadge key={wi} text={w} />
            ))}
            <SegmentDetailToggle segment={segment} />
          </StationNode>
        </div>
      ))}
    </div>
  );
}
