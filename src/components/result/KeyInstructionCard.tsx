import { ROUTE_MODE_LABEL, type RouteGuide } from "@/lib/domain/route";
import { SaveRouteButton } from "./SaveRouteButton";

interface KeyInstructionCardProps {
  route: RouteGuide;
  originStationId: string;
  destinationStationId: string;
  canSave: boolean;
}

export function KeyInstructionCard({
  route,
  originStationId,
  destinationStationId,
  canSave,
}: KeyInstructionCardProps) {
  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--brand)] p-5 text-[var(--brand-contrast)]">
      <span className="inline-block rounded-[var(--radius-pill)] bg-black/10 px-2.5 py-1 text-xs font-bold">
        {ROUTE_MODE_LABEL[route.mode]}モード
      </span>
      <p className="mt-3 text-lg font-black leading-snug">{route.keyInstruction.text}</p>
      <div className="mt-4 flex items-center justify-between text-sm font-semibold">
        <span>
          {route.summary.originName} → {route.summary.destinationName}
        </span>
        {canSave ? (
          <SaveRouteButton
            routeGuideId={route.routeId}
            label={`${route.summary.originName} → ${route.summary.destinationName}`}
            originStationId={originStationId}
            destinationStationId={destinationStationId}
            mode={route.mode}
          />
        ) : null}
      </div>
    </div>
  );
}
