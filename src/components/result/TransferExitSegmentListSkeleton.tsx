/**
 * TransferExitSegmentList の Suspense fallback。
 */
export function TransferExitSegmentListSkeleton() {
  return (
    <ol className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1].map((i) => (
        <li
          key={i}
          className="animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <div className="h-3 w-20 rounded-full bg-[var(--surface-raised)]" />
          <div className="mt-3 h-4 w-2/3 rounded-full bg-[var(--surface-raised)]" />
        </li>
      ))}
    </ol>
  );
}
