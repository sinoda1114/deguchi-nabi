import { Chip } from "@heroui/react";

interface WarningBadgeProps {
  text: string;
}

export function WarningBadge({ text }: WarningBadgeProps) {
  return (
    <div className="mt-2">
      <Chip color="warning" variant="soft" size="sm">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
        >
          <path d="M8 4.5v4.2 M8 10.8h.01" />
        </svg>
        <Chip.Label>{text}</Chip.Label>
      </Chip>
    </div>
  );
}
