import type { FacilityType } from "@/lib/domain/station";

interface FacilityIconProps {
  type: FacilityType | "train" | "car";
  className?: string;
}

const PATHS: Record<string, string> = {
  stairs: "M3 17h4v-4h4v-4h4v-4h4 M3 17V13h4 M7 13V9h4 M11 9V5h4",
  escalator: "M3 17h4l10-10h4 M9 17h4l6-6",
  elevator: "M5 3h10v18H5V3Z M9 8l3-3 3 3 M9 14l3 3 3-3",
  gate: "M4 3v18 M14 3v18 M4 9h10 M4 15h10",
  exit: "M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4 M13 8l4 4-4 4 M17 12H8",
  passage: "M3 12h18 M14 6l6 6-6 6",
  train: "M6 3h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M4 15l-2 4 M16 15l2 4 M6 7h8",
  car: "M4 16h1a2 2 0 0 0 4 0h6a2 2 0 0 0 4 0h1v-4l-2-4H6L4 12v4Z M4 12h16",
};

const LABELS: Record<string, string> = {
  stairs: "階段",
  escalator: "エスカレーター",
  elevator: "エレベーター",
  gate: "改札",
  exit: "出口",
  passage: "連絡通路",
  train: "列車",
  car: "号車",
};

export function FacilityIcon({ type, className = "h-4 w-4" }: FacilityIconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label={LABELS[type]}
    >
      <path d={PATHS[type]} />
    </svg>
  );
}
