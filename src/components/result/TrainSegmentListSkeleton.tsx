/**
 * TrainSegmentList の Suspense fallback。
 * 号車情報は Gemini 呼び出しを含み数秒〜数十秒かかりうるため、
 * 何もフィードバックが無いと壊れて見える。進捗ラベルを添える。
 */
export function TrainSegmentListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-[var(--foreground-muted)]" role="status">
        号車情報を確認しています…
      </p>
      <ol className="flex flex-col gap-3" aria-hidden="true">
        {[0, 1].map((i) => (
          <li
            key={i}
            className="animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="h-3 w-24 rounded-full bg-[var(--surface-raised)]" />
            <div className="mt-3 h-4 w-3/4 rounded-full bg-[var(--surface-raised)]" />
            <div className="mt-2 h-3 w-1/2 rounded-full bg-[var(--surface-raised)]" />
          </li>
        ))}
      </ol>
    </div>
  );
}
