import { Chip } from "@heroui/react";
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

const COLOR: Record<ConfidenceLevel, "success" | "warning" | "danger" | "default"> = {
  high: "success",
  medium: "warning",
  low: "danger",
  unavailable: "default",
};

export function ConfidenceBadge({ level, size = "md" }: ConfidenceBadgeProps) {
  return (
    <Chip color={COLOR[level]} variant="soft" size={size === "sm" ? "sm" : "md"}>
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
      <Chip.Label>信頼度: {CONFIDENCE_LABEL[level]}</Chip.Label>
    </Chip>
  );
}
