import type { RouteSegment } from "@/lib/domain/route";

interface SegmentDetailProps {
  segment: RouteSegment;
}

/**
 * 区間の詳細情報(instruction文・ホーム番号・乗車理由)を常時展開表示する。
 * 以前はボタンクリックで開閉するトグルUIだったが、ユーザーから「毎回
 * 詳細を見るために押すのが手間」との指摘を受け、常に展開した状態で
 * 表示する設計に変更した(SegmentDetailToggleから改名)。
 */
export function SegmentDetail({ segment }: SegmentDetailProps) {
  return (
    <div className="mt-2 rounded-[var(--radius-card)] bg-[var(--surface-raised)] p-3">
      <p className="text-sm font-semibold text-[var(--foreground)]">{segment.instruction}</p>
      {segment.platform ? (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--foreground-muted)]">
          <div className="flex gap-1">
            <dt className="font-bold">ホーム</dt>
            <dd>{segment.platform}番線</dd>
          </div>
        </dl>
      ) : null}
      {segment.boardingPosition?.reason ? (
        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
          理由: {segment.boardingPosition.reason}
        </p>
      ) : null}
    </div>
  );
}
