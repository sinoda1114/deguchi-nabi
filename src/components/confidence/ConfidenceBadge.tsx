import type { ConfidenceLevel } from "@/lib/domain/confidence";
import { CONFIDENCE_LABEL } from "@/lib/domain/confidence";

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  size?: "sm" | "md";
}

const ICON_PATH: Record<ConfidenceLevel, string> = {
  high: "M4.5 8.5 7 11l4.5-6",
  medium: "M8 4.5v4.2 M8 10.8h.01",
  low: "M8 3 1 13h14L8 3Z M8 6.5v3 M8 11h.01",
  unavailable: "M6 6a2 2 0 1 1 2.8 1.8c-.6.3-.8.8-.8 1.4v.3 M8 11.2h.01",
};

const STYLE: Record<ConfidenceLevel, string> = {
  high: "bg-[var(--confidence-high-bg)] text-[var(--confidence-high-fg)]",
  medium: "bg-[var(--confidence-medium-bg)] text-[var(--confidence-medium-fg)]",
  low: "bg-[var(--confidence-low-bg)] text-[var(--confidence-low-fg)]",
  unavailable:
    "bg-[var(--confidence-unavailable-bg)] text-[var(--confidence-unavailable-fg)]",
};

export function ConfidenceBadge({ level, size = "md" }: ConfidenceBadgeProps) {
  const dims = size === "sm" ? "h-5 gap-1 px-1.5 text-[11px]" : "h-6 gap-1.5 px-2 text-xs";
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] font-bold tracking-wide ${dims} ${STYLE[level]}`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"}
        aria-hidden="true"
      >
        <path d={ICON_PATH[level]} />
      </svg>
      信頼度: {CONFIDENCE_LABEL[level]}
    </span>
  );
}
