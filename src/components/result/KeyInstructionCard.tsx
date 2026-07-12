import type { ReactNode } from "react";
import { ROUTE_MODE_LABEL, type RouteMode } from "@/lib/domain/route";
import { SaveRouteButton } from "./SaveRouteButton";

interface KeyInstructionCardProps {
  mode: RouteMode;
  routeId: string;
  originName: string;
  destinationName: string;
  originStationId: string;
  destinationStationId: string;
  canSave: boolean;
  /**
   * 見出しの案内文言。号車・改札・出口情報の解決を待つ必要があるため、
   * 呼び出し元(page.tsx)が <Suspense><KeyInstructionText .../></Suspense> を渡す。
   */
  keyInstructionNode: ReactNode;
}

export function KeyInstructionCard({
  mode,
  routeId,
  originName,
  destinationName,
  originStationId,
  destinationStationId,
  canSave,
  keyInstructionNode,
}: KeyInstructionCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--accent)] p-5 text-[var(--accent-foreground)]">
      <span className="inline-block rounded-[var(--radius-pill)] bg-black/10 px-2.5 py-1 text-xs font-bold">
        {ROUTE_MODE_LABEL[mode]}モード
      </span>
      <p className="mt-3 text-lg font-black leading-snug">{keyInstructionNode}</p>
      <div className="mt-4 flex items-center justify-between text-sm font-semibold">
        <span>
          {originName} → {destinationName}
        </span>
        {canSave ? (
          <SaveRouteButton
            routeGuideId={routeId}
            label={`${originName} → ${destinationName}`}
            originStationId={originStationId}
            destinationStationId={destinationStationId}
            mode={mode}
          />
        ) : null}
      </div>
    </div>
  );
}
