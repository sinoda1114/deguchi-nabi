/**
 * TransferExitSegmentList の Suspense fallback。
 * 改札・出口情報は Gemini 呼び出しを含み数秒〜数十秒かかりうるため、
 * 何もフィードバックが無いと壊れて見える。進捗ラベルを添える。
 */
export function TransferExitSegmentListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-[var(--foreground-muted)]" role="status">
        改札・出口情報を確認しています…
      </p>
      <ol className="flex flex-col gap-3" aria-hidden="true">
        {[0, 1].map((i) => (
          <li
            key={i}
            className="animate-pulse rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="h-3 w-20 rounded-full bg-[var(--surface-raised)]" />
            <div className="mt-3 h-4 w-2/3 rounded-full bg-[var(--surface-raised)]" />
          </li>
        ))}
      </ol>
    </div>
  );
}
