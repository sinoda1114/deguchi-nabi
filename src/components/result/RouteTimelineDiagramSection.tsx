import type { RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { buildRouteTimelineNodes } from "@/lib/services/route-timeline-nodes";
import { RouteTimelineDiagram } from "@/components/diagram/RouteTimelineDiagram";

interface RouteTimelineDiagramSectionProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  destinationName: string;
}

/**
 * 経路全体を一目で把握できる縦タイムラインのセクション。
 * train区間とfacilities(出口)の両方が揃って初めて意味を成す図のため、
 * Promise.all で両方を待つ(RouteDiagramSectionと同じ設計方針)。
 */
export async function RouteTimelineDiagramSection({
  trainSegmentsPromise,
  facilitiesPromise,
  destinationName,
}: RouteTimelineDiagramSectionProps) {
  const [trainSegments, facilitiesResult] = await Promise.all([
    trainSegmentsPromise,
    facilitiesPromise,
  ]);

  if (!facilitiesResult.ok) {
    return (
      <p className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm font-semibold text-[var(--foreground-muted)]">
        {facilitiesResult.reason}
      </p>
    );
  }

  const nodes = buildRouteTimelineNodes(trainSegments, facilitiesResult.result, destinationName);

  return <RouteTimelineDiagram nodes={nodes} />;
}
