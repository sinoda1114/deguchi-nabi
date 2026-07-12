/**
 * RecommendedExitValue の Suspense fallback。
 */
export function RecommendedExitValueSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-16 animate-pulse rounded-full bg-[var(--surface-raised)] align-middle"
    />
  );
}
