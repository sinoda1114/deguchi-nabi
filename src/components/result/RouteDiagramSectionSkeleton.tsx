/**
 * RouteDiagramSection の Suspense fallback。
 */
export function RouteDiagramSectionSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--surface-raised)]" />
          <div className="h-4 flex-1 rounded-full bg-[var(--surface-raised)]" />
        </div>
      ))}
    </div>
  );
}
