interface WarningBadgeProps {
  text: string;
}

export function WarningBadge({ text }: WarningBadgeProps) {
  return (
    <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--confidence-low-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--confidence-low-fg)]">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      >
        <path d="M8 3 1 13h14L8 3Z M8 6.5v3 M8 11h.01" />
      </svg>
      <span>{text}</span>
    </div>
  );
}
