/**
 * RouteOverviewContent の Suspense fallback。
 */
export function RouteOverviewContentSkeleton() {
  return (
    <div aria-hidden="true" className="mt-4 grid grid-cols-2 gap-3">
      <div className="h-16 animate-pulse rounded-[var(--radius-card)] bg-black/10" />
      <div className="h-16 animate-pulse rounded-[var(--radius-card)] bg-black/10" />
      <div className="h-5 w-24 animate-pulse rounded-full bg-black/10" />
      <div className="h-5 w-24 animate-pulse rounded-full bg-black/10" />
    </div>
  );
}
