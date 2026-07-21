import type { RouteTimelineIcon, RouteTimelineNode } from "@/lib/services/route-timeline-nodes";
import { FacilityIcon } from "./FacilityIcon";

interface RouteTimelineDiagramProps {
  nodes: RouteTimelineNode[];
}

/**
 * 各ノードの色。乗車・ホーム設備は種別配色(--segment-train)に合わせ、
 * 改札は乗換の延長(--segment-transfer)、通路は経由点として控えめな
 * グレー、出口は既存ブランドカラー(--accent)、方角のみの推奨方向は
 * 未確定であることを示す--warning、目的地はゴール地点として目立つ
 * --dangerを使う(「駅でスマホを2〜3秒見ただけで次の行動が分かる」
 * ことを優先し、ノードごとの意味を色で瞬時に伝える)。
 */
const NODE_ACCENT: Record<RouteTimelineIcon, string> = {
  start: "var(--foreground-muted)",
  train: "var(--segment-train)",
  facility: "var(--segment-train)",
  gate: "var(--segment-transfer)",
  passage: "var(--foreground-muted)",
  direction: "var(--warning)",
  exit: "var(--accent)",
  destination: "var(--danger)",
};

/**
 * NODE_ACCENTの各背景色に対して十分なコントラストを持つ前景色。
 * text-white固定だと--segment-trainのような明度の高い色でコントラスト
 * 不足になるため、既存デザイントークンの対応するforeground変数を使う
 * (start/passageは専用のforeground変数が無いため、明度差が大きく
 * 確保できる--backgroundで代用する。AIレビュー指摘に基づく修正)。
 */
const NODE_FOREGROUND: Record<RouteTimelineIcon, string> = {
  start: "var(--background)",
  train: "var(--segment-train-foreground)",
  facility: "var(--segment-train-foreground)",
  gate: "var(--segment-transfer-foreground)",
  passage: "var(--background)",
  direction: "var(--warning-foreground)",
  exit: "var(--accent-foreground)",
  destination: "var(--danger-foreground)",
};

/**
 * 経路全体を一目で把握できる縦タイムライン。出発駅→乗車→到着駅→出口→目的地を
 * SVGアイコン付きのノードと接続線でつなぐ(「ルート全体が見えない、今どこで
 * あと何駅か分からない」というフィードバックへの対応)。詳細情報は持たず、
 * 全体像の把握に徹する(詳細はRouteDiagram/SegmentDetailで確認する)。
 */
export function RouteTimelineDiagram({ nodes }: RouteTimelineDiagramProps) {
  return (
    <div aria-label="ルート全体の流れ" className="flex flex-col">
      {nodes.map((node, i) => {
        const isLast = i === nodes.length - 1;
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: NODE_ACCENT[node.icon], color: NODE_FOREGROUND[node.icon] }}
              >
                <FacilityIcon type={node.icon} className="h-4 w-4" />
              </span>
              {!isLast ? (
                <div
                  className="route-timeline-connector w-0.5 flex-1 bg-[var(--border)]"
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className={isLast ? "pb-1" : "pb-4"}>
              <p className="font-bold leading-tight text-[var(--foreground)]">{node.label}</p>
              {node.sub ? (
                <p className="text-xs text-[var(--foreground-muted)]">{node.sub}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
