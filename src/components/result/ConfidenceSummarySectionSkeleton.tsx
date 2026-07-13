/**
 * ConfidenceSummarySection の Suspense fallback。
 */
export function ConfidenceSummarySectionSkeleton() {
  return (
    <div
      className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-hidden="true"
    >
      <div className="skeleton-shimmer mb-3 h-3 w-24 rounded-full" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="skeleton-shimmer h-3 w-16 rounded-full" />
            <div className="skeleton-shimmer h-4 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
