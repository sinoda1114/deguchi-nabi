/**
 * TrainSegmentList の Suspense fallback。
 */
export function TrainSegmentListSkeleton() {
  return (
    <ol className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1].map((i) => (
        <li
          key={i}
          className="animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <div className="h-3 w-24 rounded-full bg-[var(--surface-raised)]" />
          <div className="mt-3 h-4 w-3/4 rounded-full bg-[var(--surface-raised)]" />
          <div className="mt-2 h-3 w-1/2 rounded-full bg-[var(--surface-raised)]" />
        </li>
      ))}
    </ol>
  );
}
