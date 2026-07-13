import { FacilityIcon } from "@/components/diagram/FacilityIcon";

interface OverviewStatProps {
  icon: "car" | "exit";
  primary: string;
  secondary?: string;
}

/**
 * サマリーカード上部の号車・出口欄で共有する見た目(RouteBoardingStat/RouteExitStatで使用)。
 */
export function OverviewStat({ icon, primary, secondary }: OverviewStatProps) {
  return (
    <div className="stream-reveal rounded-[var(--radius-card)] bg-black/10 p-3">
      <FacilityIcon type={icon} className="h-4 w-4 opacity-80" />
      <p className="mt-1 text-xl font-black leading-none">{primary}</p>
      {secondary ? <p className="mt-0.5 text-xs opacity-80">{secondary}</p> : null}
    </div>
  );
}
