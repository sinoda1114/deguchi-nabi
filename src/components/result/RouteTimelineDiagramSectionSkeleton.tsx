/**
 * RouteTimelineDiagramSection の Suspense fallback。
 */
export function RouteTimelineDiagramSectionSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[var(--surface-raised)]" />
          <div className="h-4 w-32 animate-pulse rounded-full bg-[var(--surface-raised)]" />
        </div>
      ))}
    </div>
  );
}
