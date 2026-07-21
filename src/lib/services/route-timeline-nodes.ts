import type { GuideStepType, RouteSegment } from "@/lib/domain/route";
import type { FacilitiesBuildSuccess } from "./route-search";

export type RouteTimelineIcon =
  | "start"
  | "train"
  | "facility"
  | "gate"
  | "direction"
  | "passage"
  | "exit"
  | "destination";

export interface RouteTimelineNode {
  label: string;
  icon: RouteTimelineIcon;
  sub: string | null;
}

/**
 * GuideStepType ごとのアイコン対応。網羅的なRecordにすることで、将来
 * GuideStepTypeが増えた際にここへの追記漏れをコンパイルエラーで検知する
 * (guide-step-visibility.tsのfail-closed設計と同じ考え方)。
 */
const GUIDE_STEP_ICON: Record<GuideStepType, RouteTimelineIcon> = {
  boarding: "train",
  alighting: "train",
  platform_facility: "facility",
  ticket_gate: "gate",
  post_gate_direction: "direction",
  public_passage: "passage",
  underground_mall: "passage",
  street_exit: "exit",
  destination_direction: "direction",
};

/**
 * 経路全体を一目で把握できる縦タイムライン(RouteTimelineDiagram)用のノード列を
 * 組み立てる。「駅でスマホを2〜3秒見ただけで次の行動が分かる」ことを優先し、
 * 号車・出口以外の詳細(路線名・信頼度等)はここでは持たない(詳細は
 * RouteDiagram/SegmentDetail側で確認する設計)。
 *
 * 号車情報(sub)は各区間の乗車駅(segment.from)のノードに付与する。到着駅
 * (segment.to)側に付けると「その駅で乗るべき号車」に読めてしまい、乗換を
 * 挟む経路で誤乗車を誘発しかねないため(AIレビュー指摘に基づく修正)。
 *
 * 改札後のステップは facilities.arrivalGuide.steps から動的に生成する。
 * 存在しないステップ(小規模駅等)は自然に省略され、大規模駅は中間ステップが
 * 増える。確認できていない改札・出口を推測で埋めたノードは出さない
 * (arrivalGuide.stepsは生成側が既にその方針でフィルタ済み)。
 */
export function buildRouteTimelineNodes(
  trainSegments: RouteSegment[],
  facilities: FacilitiesBuildSuccess,
  destinationName: string
): RouteTimelineNode[] {
  const nodes: RouteTimelineNode[] = [];

  trainSegments.forEach((segment, i) => {
    nodes.push({
      label: segment.from,
      icon: i === 0 ? "start" : "train",
      sub: segment.boardingPosition ? `${segment.boardingPosition.carNumber}号車` : null,
    });
  });

  if (trainSegments.length > 0) {
    nodes.push({ label: trainSegments[trainSegments.length - 1].to, icon: "train", sub: null });
  }

  facilities.arrivalGuide.steps.forEach((step) => {
    nodes.push({
      label: step.title,
      icon: GUIDE_STEP_ICON[step.type],
      sub: null,
    });
  });

  // 具体的な出口が確認できておらず(destination_directionステップも
  // 生成されておらず)、かつ方角のみ判明している場合だけ、方角を「推奨方向」
  // として独立ノードで補う(出口名の代わりとしては使わない)。
  // arrivalGuide.stepsにdestination_direction型が含まれる場合、その
  // instructionはdestinationDirectionと同じ内容を表す不変条件があるため
  // (domain/route.tsのArrivalGuideコメント参照)、二重表示を避ける。
  const hasConfirmedExitOrDirectionStep = facilities.arrivalGuide.steps.some(
    (step) => step.type === "street_exit" || step.type === "destination_direction"
  );
  if (!hasConfirmedExitOrDirectionStep && facilities.arrivalGuide.destinationDirection) {
    nodes.push({
      label: `推奨方向: ${facilities.arrivalGuide.destinationDirection}側`,
      icon: "direction",
      sub: null,
    });
  }

  nodes.push({ label: destinationName, icon: "destination", sub: null });

  return nodes;
}
