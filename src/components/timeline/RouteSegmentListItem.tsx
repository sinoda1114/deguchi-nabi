import type { RouteSegment } from "@/lib/domain/route";
import { ConfidenceBadge } from "@/components/confidence/ConfidenceBadge";
import { FacilityIcon } from "@/components/diagram/FacilityIcon";
import { WarningBadge } from "@/components/diagram/WarningBadge";

interface RouteSegmentListItemProps {
  segment: RouteSegment;
}

const SEGMENT_TITLE: Record<RouteSegment["type"], string> = {
  train: "乗車",
  transfer: "乗換え",
  station_walk: "駅構内移動",
  exit: "降車・出口",
};

/**
 * 経路の1区間を表す <li>。STEP番号は JS の index ではなく CSS counter
 * (globals.css の .route-step / .route-step-label::before) で採番する。
 * これにより、TrainSegmentList と TransferExitSegmentList のように
 * 別々の Suspense 境界(別コンポーネント)に分割しても、DOM順序さえ
 * 正しければ祖先で共有した counter-reset の値を引き継いで連番になる。
 */
export function RouteSegmentListItem({ segment }: RouteSegmentListItemProps) {
  return (
    <li className="route-step rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="route-step-label text-xs font-bold uppercase tracking-wide text-[var(--accent)]">
          {SEGMENT_TITLE[segment.type]}
        </span>
        <ConfidenceBadge level={segment.confidence.level} size="sm" />
      </div>

      <p className="text-sm font-semibold text-[var(--foreground)]">
        {segment.instruction}
      </p>

      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--foreground-muted)]">
        {segment.line ? (
          <div className="flex gap-1">
            <dt className="font-bold">路線</dt>
            <dd>{segment.line}</dd>
          </div>
        ) : null}
        {segment.direction ? (
          <div className="flex gap-1">
            <dt className="font-bold">方面</dt>
            <dd>{segment.direction}</dd>
          </div>
        ) : null}
        {segment.platform ? (
          <div className="flex gap-1">
            <dt className="font-bold">ホーム</dt>
            <dd>{segment.platform}番線</dd>
          </div>
        ) : null}
        {segment.boardingPosition ? (
          <div className="flex gap-1">
            <dt className="font-bold">推奨号車</dt>
            <dd>
              {segment.boardingPosition.carNumber}号車・{segment.boardingPosition.doorPosition}
            </dd>
          </div>
        ) : null}
      </dl>

      {segment.facilities.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {segment.facilities.map((facility, fi) => (
            <span
              key={fi}
              className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--surface-raised)] px-2 py-1 text-xs font-semibold"
            >
              <FacilityIcon type={facility.facilityType} className="h-3.5 w-3.5" />
              {facility.name}
            </span>
          ))}
        </div>
      ) : null}

      {segment.boardingPosition?.reason ? (
        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
          理由: {segment.boardingPosition.reason}
        </p>
      ) : null}

      {segment.warnings.map((w, wi) => (
        <WarningBadge key={wi} text={w} />
      ))}
    </li>
  );
}
