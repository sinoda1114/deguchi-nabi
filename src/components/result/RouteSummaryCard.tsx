import type { RouteGuide } from "@/lib/domain/route";

interface RouteSummaryCardProps {
  route: RouteGuide;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--border)] py-2 text-sm last:border-none">
      <span className="text-[var(--foreground-muted)]">{label}</span>
      <span className="font-semibold text-[var(--foreground)]">{value}</span>
    </div>
  );
}

export function RouteSummaryCard({ route }: RouteSummaryCardProps) {
  const { summary } = route;
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4">
      <Row label="出発地" value={summary.originName} />
      <Row label="目的地" value={summary.destinationName} />
      <Row label="降車駅" value={summary.arrivalStationName} />
      <Row label="推奨出口" value={summary.recommendedExit} />
      <Row
        label="所要時間の目安"
        value={
          summary.estimatedDurationMinutes != null
            ? `約${summary.estimatedDurationMinutes}分`
            : "確認できません"
        }
      />
      <Row label="乗換回数" value={`${summary.transferCount}回`} />
    </div>
  );
}
