"use client";

import { useId, useState } from "react";
import type { RouteSegment } from "@/lib/domain/route";

interface SegmentDetailToggleProps {
  segment: RouteSegment;
}

/**
 * 区間の詳細情報(instruction文・ホーム番号・乗車理由)を折りたたみで表示する。
 * 「区間の詳細」セクションと「簡易ルート図」セクションが別々に並んでいると
 * 冗長との指摘を受け、簡易ルート図の各カードに統合した(既定は非表示、
 * カード単位で開閉する)。
 */
export function SegmentDetailToggle({ segment }: SegmentDetailToggleProps) {
  const [open, setOpen] = useState(false);
  const detailId = useId();

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={`${segment.from}から${segment.to}までの詳細を見る`}
        onClick={() => setOpen((prev) => !prev)}
        className="text-xs font-semibold text-[var(--accent)] hover:underline"
      >
        {open ? "詳細を閉じる" : "詳細を見る"}
      </button>
      {open ? (
        <div
          id={detailId}
          className="mt-2 rounded-[var(--radius-card)] bg-[var(--surface-raised)] p-3"
        >
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
      ) : null}
    </div>
  );
}
