"use client";

import { Button } from "@heroui/react";
import { ROUTE_MODE_LABEL, type RouteMode } from "@/lib/domain/route";
import { SearchPictogram, type SearchPictogramType } from "./SearchPictogram";

const MODES: RouteMode[] = ["fastest", "easy", "accessible"];

const MODE_DESCRIPTION: Record<RouteMode, string> = {
  fastest: "到着時間を優先",
  easy: "乗換・改札・出口が分かりやすい導線を優先",
  accessible: "階段を避け、エレベーター等を優先",
};

const MODE_ICON: Record<RouteMode, SearchPictogramType> = {
  fastest: "fastest",
  easy: "easy",
  accessible: "accessible",
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
          <Button
            key={mode}
            variant={selected ? "primary" : "secondary"}
            aria-pressed={selected}
            onPress={() => onChange(mode)}
            fullWidth
            className="h-full min-w-0 flex-col items-center gap-0.5 py-2.5 text-center whitespace-normal"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-current/10">
              <SearchPictogram type={MODE_ICON[mode]} className="h-4 w-4" />
            </span>
            <span className="text-sm font-bold">{ROUTE_MODE_LABEL[mode]}</span>
            <span className="text-[11px] leading-tight font-normal opacity-80">
              {MODE_DESCRIPTION[mode]}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
