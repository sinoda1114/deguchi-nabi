import { describe, expect, test } from "vitest";
import { buildRouteTimelineNodes } from "../route-timeline-nodes";
import type { RouteSegment } from "@/lib/domain/route";
import type { FacilitiesBuildSuccess } from "../route-search";
import type { Confidence } from "@/lib/domain/confidence";
import type { StationFacility } from "@/lib/domain/station";

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

const EXIT_FACILITY: StationFacility = {
  facilityId: "exit_1",
  stationId: "destination",
  facilityType: "exit",
  name: "A1出口",
  level: "1F",
  accessible: true,
  coordinates: null,
  connectedGateId: null,
  confidence: highConfidence,
  verifiedAt: null,
};

function buildFacilities(overrides: Partial<FacilitiesBuildSuccess> = {}): FacilitiesBuildSuccess {
  return {
    transferSegment: {
      type: "transfer",
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: null,
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "改札へ向かってください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    exitSegment: {
      type: "exit",
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: null,
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "A1出口から出てください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    recommendedExit: "A1出口",
    gate: null,
    exit: EXIT_FACILITY,
    elevator: null,
    hasApproximateGuidance: false,
    approximateDirectionLabel: null,
    ...overrides,
  };
}

describe("buildRouteTimelineNodes", () => {
  test("乗換なしの単純な経路は 出発駅→乗車→到着駅→出口→目的地 の4ノードを組み立てる", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities(),
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
    const nodes = buildRouteTimelineNodes(segments, buildFacilities(), "目的地");

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
      buildFacilities(),
      "目的地"
    );
    expect(nodes[0]).toEqual({ label: "出発駅", icon: "start", sub: null });
  });

  test("出口が確定していない(approximateタイア)場合はrecommendedExitをラベルに使う", () => {
    const nodes = buildRouteTimelineNodes(
      [buildTrainSegment()],
      buildFacilities({ exit: null, recommendedExit: "西側" }),
      "目的地"
    );
    expect(nodes[2]).toEqual({ label: "西側", icon: "exit", sub: null });
  });

  test("train区間が空の場合は出発駅ノードを含めない(データ不整合時にクラッシュしない)", () => {
    const nodes = buildRouteTimelineNodes([], buildFacilities(), "目的地");
    expect(nodes[0]).toEqual({ label: "A1出口", icon: "exit", sub: null });
    expect(nodes).toHaveLength(2);
  });
});
