import type { RouteMode, RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { computeConfidenceSummary } from "@/lib/services/route-search";
import { ConfidenceSummary } from "@/components/result/ConfidenceSummary";

interface ConfidenceSummarySectionProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  mode: RouteMode;
}

/**
 * 情報ごとの信頼度サマリー。train区間とfacilitiesの両方が揃って初めて
 * 意味のある集計ができるため、Promise.all で両方を待ってから
 * computeConfidenceSummary(route-search.ts の集約ロジック)を呼ぶ。
 */
export async function ConfidenceSummarySection({
  trainSegmentsPromise,
  facilitiesPromise,
  mode,
}: ConfidenceSummarySectionProps) {
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

  const summary = computeConfidenceSummary(trainSegments, facilitiesResult.result, mode);

  return <ConfidenceSummary summary={summary} />;
}
