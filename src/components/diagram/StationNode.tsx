import type { ReactNode } from "react";

interface StationNodeProps {
  name: string;
  /** セグメント種別(乗車・乗換・出口)を色で瞬時に区別するためのCSS変数値(例: "var(--segment-train)")。 */
  accent: string;
  /**
   * accentの背景上でも十分なコントラストを保つ前景色(例: "var(--segment-train-foreground)")。
   * 番号バッジの文字色に使う(text-white固定だと明度の高いaccentでコントラスト不足になるため)。
   */
  foreground: string;
  /** 何番目のステップか(1始まり)。省略時は番号バッジを描画しない。 */
  stepNumber?: number;
  /** ステップの種別名(「乗車」「乗換」「出口」)。stepNumberと組で使う。 */
  stepLabel?: string;
  children?: ReactNode;
}

export function StationNode({
  name,
  accent,
  foreground,
  stepNumber,
  stepLabel,
  children,
}: StationNodeProps) {
  return (
    <div
      className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden="true"
        />
        {stepNumber != null ? (
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] px-1.5 text-[11px] font-bold"
            style={{ backgroundColor: accent, color: foreground }}
          >
            {stepNumber}
          </span>
        ) : null}
        {stepLabel ? (
          <span className="text-xs font-bold" style={{ color: accent }}>
            {stepLabel}
          </span>
        ) : null}
        <span className="font-bold text-[var(--foreground)]">{name}</span>
      </div>
      {children ? <div className="mt-2 pl-5">{children}</div> : null}
    </div>
  );
}
