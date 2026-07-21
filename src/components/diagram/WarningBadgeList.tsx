interface WarningBadgeListProps {
  texts: string[];
}

/**
 * 複数の警告文言を1枚の箱にまとめ、箇条書きで表示する。WarningBadge(単一の
 * Chip)を複数並べると縦にベージュの箱が積み重なって見えるとのフィードバックを
 * 受け、経路結果画面上部の警告(AI/Web検索由来の警告 + 出発時刻未指定の免責文言)
 * 用にまとめ表示専用のコンポーネントとして切り出した。
 *
 * WarningBadge自体は区間ごとの警告(RouteDiagram.tsx)やFacilitiesWarningBadges
 * でも使われているため変更しない。配色・アイコンはWarningBadgeの見た目を踏襲するが、
 * 複数行の箇条書きを収める都合上、Chipではなく--warning/--warning-foreground
 * CSS変数を使った素のdiv+ulで実装している。
 */
export function WarningBadgeList({ texts }: WarningBadgeListProps) {
  if (texts.length === 0) return null;

  return (
    <div className="flex gap-2 rounded-[var(--radius-card)] bg-[var(--warning)] p-3 text-[var(--warning-foreground)]">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-4 w-4 shrink-0"
        aria-hidden="true"
      >
        <path d="M8 4.5v4.2 M8 10.8h.01" />
      </svg>
      <ul className="flex flex-col gap-1 text-xs font-semibold leading-snug">
        {texts.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </div>
  );
}
