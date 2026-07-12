/**
 * ConfidenceSummarySection の Suspense fallback。
 */
export function ConfidenceSummarySectionSkeleton() {
  return (
    <div
      className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-hidden="true"
    >
      <div className="mb-3 h-3 w-24 animate-pulse rounded-full bg-[var(--surface-raised)]" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex animate-pulse items-center justify-between">
            <div className="h-3 w-16 rounded-full bg-[var(--surface-raised)]" />
            <div className="h-4 w-12 rounded-full bg-[var(--surface-raised)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
