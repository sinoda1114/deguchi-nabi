"use client";

import { ROUTE_MODE_LABEL, type RouteMode } from "@/lib/domain/route";

const MODES: RouteMode[] = ["fastest", "easy", "accessible"];

const MODE_DESCRIPTION: Record<RouteMode, string> = {
  fastest: "到着時間を優先",
  easy: "乗換・改札・出口が分かりやすい導線を優先",
  accessible: "階段を避け、エレベーター等を優先",
};

interface RouteModeSelectorProps {
  value: RouteMode;
  onChange: (mode: RouteMode) => void;
}

export function RouteModeSelector({ value, onChange }: RouteModeSelectorProps) {
  return (
    <div role="radiogroup" aria-label="ルートモード" className="grid grid-cols-3 gap-2">
      {MODES.map((mode) => {
        const selected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(mode)}
            className={`flex flex-col items-start gap-0.5 rounded-[var(--radius-card)] border px-3 py-2.5 text-left transition-colors duration-[var(--duration-fast)] ${
              selected
                ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--brand)]"
            }`}
          >
            <span className="text-sm font-bold">{ROUTE_MODE_LABEL[mode]}</span>
            <span
              className={`text-[11px] leading-tight ${
                selected ? "text-[var(--brand-contrast)]/80" : "text-[var(--foreground-muted)]"
              }`}
            >
              {MODE_DESCRIPTION[mode]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
