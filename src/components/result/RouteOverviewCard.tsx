import type { ReactNode } from "react";
import { ROUTE_MODE_LABEL, type RouteMode } from "@/lib/domain/route";
import { SaveRouteButton } from "./SaveRouteButton";

interface RouteOverviewCardProps {
  mode: RouteMode;
  routeId: string;
  originName: string;
  destinationName: string;
  originStationId: string;
  destinationStationId: string;
  canSave: boolean;
  estimatedDurationMinutes: number | null;
  /**
   * 号車・出口・乗換回数・迷いにくさの概要部分。号車・改札・出口情報の
   * 解決を待つ必要があるため、呼び出し元(page.tsx)が
   * <Suspense><RouteOverviewContent .../></Suspense> を渡す。
   */
  overviewContentNode: ReactNode;
}

/**
 * 画面最上部のサマリーカード。旧KeyInstructionCard(文章での案内)と
 * 旧RouteSummaryCard(表形式の詳細)を統合し、号車・出口という
 * 「一番重要な情報」を画面最上部で一番大きく表示する
 * (歩きながら3秒で理解できることを優先するとのフィードバックに基づく)。
 */
export function RouteOverviewCard({
  mode,
  routeId,
  originName,
  destinationName,
  originStationId,
  destinationStationId,
  canSave,
  estimatedDurationMinutes,
  overviewContentNode,
}: RouteOverviewCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--accent)] p-5 text-[var(--accent-foreground)]">
      <div className="flex items-center justify-between">
        <span className="inline-block rounded-[var(--radius-pill)] bg-black/10 px-2.5 py-1 text-xs font-bold">
          {ROUTE_MODE_LABEL[mode]}モード
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
      {overviewContentNode}
      <p className="mt-4 text-sm font-semibold opacity-90">
        {originName} → {destinationName}
        {" ・ "}
        {estimatedDurationMinutes != null ? `約${estimatedDurationMinutes}分` : "確認できません"}
      </p>
    </div>
  );
}
