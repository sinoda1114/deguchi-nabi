/**
 * RouteBoardingStat の Suspense fallback。
 */
export function RouteBoardingStatSkeleton() {
  return (
    <div aria-hidden="true" className="h-16 animate-pulse rounded-[var(--radius-card)] bg-black/10" />
  );
}
