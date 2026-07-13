/**
 * RouteExitStat の Suspense fallback。
 */
export function RouteExitStatSkeleton() {
  return (
    <div aria-hidden="true" className="h-16 animate-pulse rounded-[var(--radius-card)] bg-black/10" />
  );
}
