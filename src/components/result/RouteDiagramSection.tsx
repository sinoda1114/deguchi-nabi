import type { RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { RouteDiagram } from "@/components/diagram/RouteDiagram";

interface RouteDiagramSectionProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * train区間 + transfer/exitセグメントを結合した簡易ルート図。
 * 2つのPromiseを Promise.all で並行に待つ(どちらかが早く終わっても
 * 図としては両方揃わないと意味を成さないため)。
 */
export async function RouteDiagramSection({
  trainSegmentsPromise,
  facilitiesPromise,
}: RouteDiagramSectionProps) {
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

  const segments: RouteSegment[] = [
    ...trainSegments,
    facilitiesResult.result.transferSegment,
    facilitiesResult.result.exitSegment,
  ];

  return <RouteDiagram segments={segments} />;
}
