/**
 * RouteBoardingStat の Suspense fallback。
 */
export function RouteBoardingStatSkeleton() {
  return (
    <div aria-hidden="true" className="skeleton-shimmer-on-accent h-16 rounded-[var(--radius-card)]" />
  );
}
