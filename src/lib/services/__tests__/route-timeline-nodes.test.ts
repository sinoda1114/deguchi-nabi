import { describe, expect, test } from "vitest";
import { buildRouteTimelineNodes } from "../route-timeline-nodes";
import type { ArrivalGuide, GuideStep, RouteSegment } from "@/lib/domain/route";
import type { FacilitiesBuildSuccess } from "../route-search";
import type { Confidence } from "@/lib/domain/confidence";
import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

function buildTrainSegment(overrides: Partial<RouteSegment> = {}): RouteSegment {
  return {
    type: "train",
    from: "出発駅",
    to: "到着駅",
    line: "テスト線",
    direction: "到着駅方面",
    platform: "1",
    boardingPosition: {
      carNumber: 5,
      doorPosition: "中央",
      reason: "テスト用の理由",
    },
    facilities: [],
    instruction: "テスト線で5号車付近に乗車してください。",
    confidence: highConfidence,
    sourceReferences: [],
    warnings: [],
    ...overrides,
  };
}

function guideStep(overrides: Partial<GuideStep> = {}): GuideStep {
  return {
    type: "street_exit",
    title: "A1出口",
    instruction: "A1出口から地上へ出てください。",
    landmarks: [],
    confidence: highConfidence,
    provenance: "surveyed",
    ...overrides,
  };
}

/**
 * stepsの内容(ticket_gate/street_exitの有無)からfacilityを機械的に導出する。
 * このテストファイルではfacility自体の値をアサーションしていないため、型を
 * 満たすためだけの導出でよい(呼び出し側は従来どおりstepsだけを気にすればよい)。
 */
function deriveFacility(steps: GuideStep[]): FacilityRecommendation {
  const gateStep = steps.find((step) => step.type === "ticket_gate");
  const exitStep = steps.find((step) => step.type === "street_exit");
  if (!gateStep && !exitStep) {
    return { state: "unavailable", reason: "test" };
  }
  return {
    state: "confirmed",
    pair: {
      gate: gateStep
        ? { name: gateStep.title, confidence: gateStep.confidence, provenance: gateStep.provenance }
        : null,
      exit: exitStep
        ? { name: exitStep.title, confidence: exitStep.confidence, provenance: exitStep.provenance }
        : null,
      reason: null,
    },
  };
}

function buildArrivalGuide(overrides: Partial<ArrivalGuide> = {}): ArrivalGuide {
  const steps = overrides.steps ?? [guideStep()];
  return {
    steps,
    destinationDirection: null,
    facility: deriveFacility(steps),
    ...overrides,
  };
}

function buildFacilities(
  overrides: Partial<Pick<FacilitiesBuildSuccess, "arrivalGuide">> = {}
): Pick<FacilitiesBuildSuccess, "arrivalGuide"> {
  return {
    arrivalGuide: buildArrivalGuide(),
    ...overrides,
  };
}

describe("buildRouteTimelineNodes", () => {
  test("乗換なしの単純な経路は 出発駅→到着駅→出口→目的地 のノードを組み立てる", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities() as FacilitiesBuildSuccess,
      "マクドナルド 横浜ベイクォーター店"
    );

    expect(nodes).toEqual([
      { label: "出発駅", icon: "start", sub: "5号車" },
      { label: "到着駅", icon: "train", sub: null },
      { label: "A1出口", icon: "exit", sub: null },
      { label: "マクドナルド 横浜ベイクォーター店", icon: "destination", sub: null },
    ]);
  });

  test("乗換がある経路は各train区間の乗車駅を個別のノードとして追加し、号車は乗車駅側に付与する(到着駅側に付けると『その駅で乗るべき号車』に読めてしまうため)", () => {
    const segments = [
      buildTrainSegment({ from: "出発駅", to: "乗換駅" }),
      buildTrainSegment({ from: "乗換駅", to: "到着駅", boardingPosition: null }),
    ];
    const nodes = buildRouteTimelineNodes(
      segments,
      buildFacilities() as FacilitiesBuildSuccess,
      "目的地"
    );

    expect(nodes).toEqual([
      { label: "出発駅", icon: "start", sub: "5号車" },
      { label: "乗換駅", icon: "train", sub: null },
      { label: "到着駅", icon: "train", sub: null },
      { label: "A1出口", icon: "exit", sub: null },
      { label: "目的地", icon: "destination", sub: null },
    ]);
  });

  test("号車情報が無い区間はsubをnullにする", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment({ boardingPosition: null })],
      buildFacilities() as FacilitiesBuildSuccess,
      "目的地"
    );
    expect(nodes[0]).toEqual({ label: "出発駅", icon: "start", sub: null });
  });

  test("大規模駅: 改札→改札後方向→通路→出口の中間ステップを順序どおりノード化する", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities({
        arrivalGuide: buildArrivalGuide({
          steps: [
            guideStep({ type: "ticket_gate", title: "中央改札" }),
            guideStep({ type: "post_gate_direction", title: "改札を出て右" }),
            guideStep({ type: "public_passage", title: "地下通路" }),
            guideStep({ type: "street_exit", title: "A7出口" }),
          ],
        }),
      }) as FacilitiesBuildSuccess,
      "目的地"
    );

    expect(nodes.map((n) => n.label)).toEqual([
      "出発駅",
      "到着駅",
      "中央改札",
      "改札を出て右",
      "地下通路",
      "A7出口",
      "目的地",
    ]);
    expect(nodes.map((n) => n.icon)).toEqual([
      "start",
      "train",
      "gate",
      "direction",
      "passage",
      "exit",
      "destination",
    ]);
  });

  test("小規模駅: 改札のみでも不要な通路ノードを追加しない(改札=出口が兼用のケース)", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities({
        arrivalGuide: buildArrivalGuide({ steps: [guideStep({ type: "ticket_gate", title: "東口改札" })] }),
      }) as FacilitiesBuildSuccess,
      "目的地"
    );
    expect(nodes.map((n) => n.label)).toEqual(["出発駅", "到着駅", "東口改札", "目的地"]);
  });

  test("具体的な出口が確認できず方角のみ判明している場合は「推奨方向」を独立ノードとして追加する(出口名の代用にしない)", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities({
        arrivalGuide: buildArrivalGuide({ steps: [], destinationDirection: "南" }),
      }) as FacilitiesBuildSuccess,
      "目的地"
    );
    expect(nodes.map((n) => n.label)).toEqual(["出発駅", "到着駅", "推奨方向: 南側", "目的地"]);
    expect(nodes.find((n) => n.label.startsWith("推奨方向"))?.icon).toBe("direction");
  });

  test("confidenceがhigh以外のステップでもラベル(値)自体は隠さず表示し、subには注記を付けない", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities({
        arrivalGuide: buildArrivalGuide({
          steps: [
            guideStep({
              type: "ticket_gate",
              title: "西改札",
              confidence: { level: "low", reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 0 },
            }),
            guideStep({
              type: "street_exit",
              title: "A1出口",
              confidence: highConfidence,
            }),
          ],
        }),
      }) as FacilitiesBuildSuccess,
      "目的地"
    );
    const gateNode = nodes.find((n) => n.label === "西改札");
    const exitNode = nodes.find((n) => n.label === "A1出口");
    expect(gateNode?.label).toBe("西改札");
    expect(gateNode?.sub).toBeNull();
    expect(exitNode?.sub).toBeNull();
  });

  test("arrivalGuide.stepsにdestination_directionステップが含まれる場合は推奨方向ノードを二重追加しない", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities({
        arrivalGuide: buildArrivalGuide({
          steps: [guideStep({ type: "destination_direction", title: "南側方面" })],
          destinationDirection: "南",
        }),
      }) as FacilitiesBuildSuccess,
      "目的地"
    );
    expect(nodes.filter((n) => n.label.startsWith("推奨方向"))).toHaveLength(0);
    expect(nodes.map((n) => n.label)).toEqual(["出発駅", "到着駅", "南側方面", "目的地"]);
  });

  test("street_exitステップがある場合は推奨方向ノードを追加しない(方角と具体的出口の重複表示を避ける)", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities({
        arrivalGuide: buildArrivalGuide({
          steps: [guideStep({ type: "street_exit", title: "A1出口" })],
          destinationDirection: "南",
        }),
      }) as FacilitiesBuildSuccess,
      "目的地"
    );
    expect(nodes.some((n) => n.label.startsWith("推奨方向"))).toBe(false);
  });

  test("改札・出口とも確認できず方角も判明していない場合は改札後ノードを一切追加しない(推測で埋めない)", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities({
        arrivalGuide: buildArrivalGuide({ steps: [], destinationDirection: null }),
      }) as FacilitiesBuildSuccess,
      "目的地"
    );
    expect(nodes.map((n) => n.label)).toEqual(["出発駅", "到着駅", "目的地"]);
  });

  test("train区間が空の場合は出発駅ノードを含めない(データ不整合時にクラッシュしない)", () => {
    const nodes = buildRouteTimelineNodes(
      [],
      buildFacilities() as FacilitiesBuildSuccess,
      "目的地"
    );
    expect(nodes[0]).toEqual({ label: "A1出口", icon: "exit", sub: null });
    expect(nodes).toHaveLength(2);
  });
});
