/**
 * RouteExitStat の Suspense fallback。
 */
export function RouteExitStatSkeleton() {
  return (
    <div aria-hidden="true" className="skeleton-shimmer-on-accent h-16 rounded-[var(--radius-card)]" />
  );
}
