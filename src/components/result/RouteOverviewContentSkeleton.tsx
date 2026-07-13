/**
 * RouteOverviewContent の Suspense fallback。
 */
export function RouteOverviewContentSkeleton() {
  return (
    <div aria-hidden="true" className="mt-4 grid grid-cols-2 gap-3">
      <div className="skeleton-shimmer-on-accent h-16 rounded-[var(--radius-card)]" />
      <div className="skeleton-shimmer-on-accent h-16 rounded-[var(--radius-card)]" />
      <div className="skeleton-shimmer-on-accent h-5 w-24 rounded-full" />
      <div className="skeleton-shimmer-on-accent h-5 w-24 rounded-full" />
    </div>
  );
}
