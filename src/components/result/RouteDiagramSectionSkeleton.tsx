/**
 * RouteDiagramSection の Suspense fallback。
 */
export function RouteDiagramSectionSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton-shimmer h-8 w-8 shrink-0 rounded-full" />
          <div className="skeleton-shimmer h-4 flex-1 rounded-full" />
        </div>
      ))}
    </div>
  );
}
