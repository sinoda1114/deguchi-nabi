import type { ReactNode } from "react";

interface StationNodeProps {
  name: string;
  children?: ReactNode;
}

export function StationNode({ name, children }: StationNodeProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)]" aria-hidden="true" />
        <span className="font-bold text-[var(--foreground)]">{name}</span>
      </div>
      {children ? <div className="mt-2 pl-5">{children}</div> : null}
    </div>
  );
}
