import { FacilityIcon } from "@/components/diagram/FacilityIcon";

interface OverviewStatProps {
  icon: "car" | "gate" | "exit";
  label: string;
  primary: string;
  secondary?: string;
}

/**
 * サマリーカード上部の乗車位置・改札・出口欄で共有する見た目
 * (RouteBoardingStat/RouteGateStat/RouteExitStatで使用)。
 * labelで各欄が何を表すかを明示する(改札(ticket_gate)と出口(street_exit)を
 * 別項目として分離した設計変更に伴い追加)。
 */
export function OverviewStat({ icon, label, primary, secondary }: OverviewStatProps) {
  return (
    <div className="stream-reveal rounded-[var(--radius-card)] bg-black/10 p-3">
      <div className="flex items-center gap-1 opacity-70">
        <FacilityIcon type={icon} className="h-3.5 w-3.5" />
        <span className="text-[0.65rem] font-bold">{label}</span>
      </div>
      <p className="mt-1 text-lg font-black leading-tight">{primary}</p>
      {secondary ? <p className="mt-0.5 text-xs opacity-80">{secondary}</p> : null}
    </div>
  );
}
