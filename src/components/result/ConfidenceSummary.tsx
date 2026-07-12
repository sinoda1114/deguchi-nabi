import type { RouteConfidenceSummary } from "@/lib/domain/route";
import { ConfidenceBadge } from "@/components/confidence/ConfidenceBadge";

interface ConfidenceSummaryProps {
  summary: RouteConfidenceSummary;
}

const ROWS: { key: keyof RouteConfidenceSummary; label: string }[] = [
  { key: "boardingPosition", label: "乗車位置" },
  { key: "transferGuide", label: "乗換導線" },
  { key: "gate", label: "改札情報" },
  { key: "exit", label: "出口情報" },
  { key: "accessibility", label: "バリアフリー情報" },
];

export function ConfidenceSummary({ summary }: ConfidenceSummaryProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="mb-3 text-xs font-bold text-[var(--foreground-muted)]">
        情報ごとの信頼度
      </h3>
      <div className="flex flex-col gap-2">
        {ROWS.filter((row) => summary[row.key] != null).map((row) => (
          <div key={row.key} className="flex items-center justify-between text-sm">
            <span>{row.label}</span>
            <ConfidenceBadge level={summary[row.key]!} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
