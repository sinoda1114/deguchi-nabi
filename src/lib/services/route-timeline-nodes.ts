import type { RouteSegment } from "@/lib/domain/route";
import type { FacilitiesBuildSuccess } from "./route-search";

export type RouteTimelineIcon = "start" | "train" | "exit" | "destination";

export interface RouteTimelineNode {
  label: string;
  icon: RouteTimelineIcon;
  sub: string | null;
}

/**
 * 経路全体を一目で把握できる縦タイムライン(RouteTimelineDiagram)用のノード列を
 * 組み立てる。「駅でスマホを2〜3秒見ただけで次の行動が分かる」ことを優先し、
 * 号車・出口以外の詳細(路線名・信頼度等)はここでは持たない(詳細は
 * RouteDiagram/SegmentDetailToggle側で確認する設計)。
 *
 * 号車情報(sub)は各区間の乗車駅(segment.from)のノードに付与する。到着駅
 * (segment.to)側に付けると「その駅で乗るべき号車」に読めてしまい、乗換を
 * 挟む経路で誤乗車を誘発しかねないため(AIレビュー指摘に基づく修正)。
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

  nodes.push({
    label: facilities.exit?.name ?? facilities.recommendedExit,
    icon: "exit",
    sub: null,
  });

  nodes.push({ label: destinationName, icon: "destination", sub: null });

  return nodes;
}
