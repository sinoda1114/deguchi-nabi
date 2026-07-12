import type { ReactNode } from "react";

interface RouteSummaryCardProps {
  originName: string;
  destinationName: string;
  arrivalStationName: string;
  /**
   * 推奨出口の行。改札・出口情報の解決を待つ必要があるため、
   * 呼び出し元(page.tsx)が <Suspense><RecommendedExitValue .../></Suspense> を渡す。
   */
  recommendedExitNode: ReactNode;
  estimatedDurationMinutes: number | null;
  transferCount: number;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--border)] py-2 text-sm last:border-none">
      <span className="text-[var(--foreground-muted)]">{label}</span>
      <span className="font-semibold text-[var(--foreground)]">{value}</span>
    </div>
  );
}

export function RouteSummaryCard({
  originName,
  destinationName,
  arrivalStationName,
  recommendedExitNode,
  estimatedDurationMinutes,
  transferCount,
}: RouteSummaryCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4">
      <Row label="出発地" value={originName} />
      <Row label="目的地" value={destinationName} />
      <Row label="降車駅" value={arrivalStationName} />
      <Row label="推奨出口" value={recommendedExitNode} />
      <Row
        label="所要時間の目安"
        value={
          estimatedDurationMinutes != null ? `約${estimatedDurationMinutes}分` : "確認できません"
        }
      />
      <Row label="乗換回数" value={`${transferCount}回`} />
    </div>
  );
}
