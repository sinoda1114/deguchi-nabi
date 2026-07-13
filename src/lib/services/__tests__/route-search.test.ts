import { describe, expect, test } from "vitest";
import {
  searchRouteGuide,
  resolveRouteCandidate,
  buildTrainSegments,
  buildTransferAndExitSegments,
  computeConfidenceSummary,
  computeKeyInstruction,
} from "@/lib/services/route-search";
import type { RouteSearchDeps } from "@/lib/services/route-search";
import type { RouteProviderPort } from "@/lib/integrations/route-provider/RouteProviderPort";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import type {
  BoardingPosition,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";
import { unavailableConfidence, type Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

const STATIONS: Record<string, Station> = {
  origin: {
    stationId: "origin",
    stationName: "出発駅",
    operator: "テスト鉄道",
    lines: ["テスト線"],
    prefecture: "東京都",
    latitude: 0,
    longitude: 0,
  },
  destination: {
    stationId: "destination",
    stationName: "到着駅",
    operator: "テスト鉄道",
    lines: ["テスト線"],
    prefecture: "東京都",
    latitude: 0,
    longitude: 0,
  },
};

const PLATFORM: Platform = {
  platformId: "platform_1",
  stationId: "origin",
  lineId: "テスト線",
  direction: "到着駅方面",
  platformNumber: "1",
};

const FACILITIES_WITH_ELEVATOR: StationFacility[] = [
  {
    facilityId: "gate_1",
    stationId: "destination",
    facilityType: "gate",
    name: "中央改札",
    level: "1F",
    accessible: true,
    coordinates: null, connectedGateId: null,
    confidence: highConfidence,
    verifiedAt: null,
  },
  {
    facilityId: "exit_1",
    stationId: "destination",
    facilityType: "exit",
    name: "A1出口",
    level: "1F",
    accessible: true,
    coordinates: null, connectedGateId: null,
    confidence: highConfidence,
    verifiedAt: null,
  },
  {
    facilityId: "elevator_1",
    stationId: "destination",
    facilityType: "elevator",
    name: "中央エレベーター",
    level: "1F",
    accessible: true,
    coordinates: null, connectedGateId: null,
    confidence: highConfidence,
    verifiedAt: null,
  },
];

const FACILITIES_WITH_ESCALATOR_AND_ELEVATOR: StationFacility[] = [
  ...FACILITIES_WITH_ELEVATOR,
  {
    facilityId: "escalator_1",
    stationId: "destination",
    facilityType: "escalator",
    name: "中央エスカレーター",
    level: "1F",
    accessible: true,
    coordinates: null, connectedGateId: null,
    confidence: highConfidence,
    verifiedAt: null,
  },
];

function buildStationProvider(facilities: StationFacility[]): StationProviderPort {
  return {
    async searchStations() {
      return Object.values(STATIONS);
    },
    async getStation(stationId: string) {
      return STATIONS[stationId] ?? null;
    },
    async getPlatforms() {
      return [PLATFORM];
    },
    async getFacilities() {
      return facilities;
    },
    async getBoardingPosition(): Promise<BoardingPosition | null> {
      return {
        boardingPositionId: "bp_1",
        platformId: PLATFORM.platformId,
        trainFormation: 10,
        carNumber: 5,
        doorPosition: "中央",
        targetFacilityId: "gate_1",
        reason: "テスト用の理由",
        confidence: highConfidence,
        verifiedAt: null,
      };
    },
    async nearestStations() {
      return Object.values(STATIONS);
    },
  };
}

function buildRouteProvider(hasRoute: boolean): RouteProviderPort {
  return {
    async findRailRoutes() {
      if (!hasRoute) return [];
      return [
        {
          originStationId: "origin",
          arrivalStationId: "destination",
          transferCount: 0,
          estimatedDurationMinutes: 10,
          segments: [
            {
              fromStationId: "origin",
              toStationId: "destination",
              line: "テスト線",
              direction: "到着駅方面",
              platformId: PLATFORM.platformId,
              estimatedMinutes: 10,
            },
          ],
        },
      ];
    },
  };
}

const BASE_INPUT = {
  originStationId: "origin",
  originLabel: "出発駅",
  destinationStationId: "destination",
  destinationLabel: "到着駅",
  destinationCoordinates: null,
  accessibility: { avoidStairs: false, preferElevator: false, preferEscalator: false },
};

describe("searchRouteGuide", () => {
  test("経路候補がない場合は ok:false を返す", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(false),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await searchRouteGuide({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(false);
  });

  test("easy モードで号車・改札・出口を含むルートを組み立てる", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await searchRouteGuide({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route.segments.some((s) => s.type === "train")).toBe(true);
    expect(result.route.summary.recommendedExit).toBe("A1出口");
    expect(result.route.confidenceSummary.gate).toBe("high");
  });

  test("accessible モードでエレベーター情報がなければ確認不能として拒否する", async () => {
    const noElevator = FACILITIES_WITH_ELEVATOR.filter((f) => f.facilityType !== "elevator");
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(noElevator),
    };
    const result = await searchRouteGuide({ ...BASE_INPUT, mode: "accessible" }, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("バリアフリー");
  });

  test("accessible モードでエレベーター情報があれば成功する", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await searchRouteGuide({ ...BASE_INPUT, mode: "accessible" }, deps);
    expect(result.ok).toBe(true);
  });

  test("号車情報が無い場合は unavailable confidence を用いる", async () => {
    const stationProvider: StationProviderPort = {
      ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
      async getBoardingPosition() {
        return null;
      },
    };
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider,
    };
    const result = await searchRouteGuide({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trainSegment = result.route.segments.find((s) => s.type === "train");
    expect(trainSegment?.confidence).toEqual(unavailableConfidence("推奨号車の情報が不足しています"));
  });

  test("fixture未収録駅を含むAI生成ルート(platformId空)でも stationId/line/direction で号車情報を取得する", async () => {
    const receivedArgs: unknown[][] = [];
    const stationProvider: StationProviderPort = {
      ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
      async getBoardingPosition(
        stationId: string,
        stationName: string,
        platformId: string,
        line: string,
        direction: string
      ) {
        receivedArgs.push([stationId, stationName, platformId, line, direction]);
        return {
          boardingPositionId: "bp_ai",
          platformId: "",
          trainFormation: 0,
          carNumber: 3,
          doorPosition: "前方",
          targetFacilityId: null,
          reason: "AIによる推測情報。現地未確認のため参考程度に扱ってください。",
          confidence: {
            level: "low",
            reasons: ["AIによる推測情報。現地未確認のため参考程度に扱ってください。"],
            verifiedAt: null,
            expiresAt: null,
            sourceCount: 0,
          },
          verifiedAt: null,
        };
      },
    };
    const routeProvider: RouteProviderPort = {
      async findRailRoutes() {
        return [
          {
            originStationId: "origin",
            arrivalStationId: "destination",
            transferCount: 0,
            estimatedDurationMinutes: 20,
            isAiGenerated: true,
            segments: [
              {
                fromStationId: "origin",
                toStationId: "destination",
                line: "テストAI線",
                direction: "到着駅方面",
                platformId: "",
                estimatedMinutes: 20,
              },
            ],
          },
        ];
      },
    };
    const deps: RouteSearchDeps = { routeProvider, stationProvider };
    const result = await searchRouteGuide({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trainSegment = result.route.segments.find((s) => s.type === "train");
    expect(trainSegment?.boardingPosition?.carNumber).toBe(3);
    expect(trainSegment?.confidence.level).toBe("low");
    expect(receivedArgs[0]).toEqual(["origin", "出発駅", "", "テストAI線", "到着駅方面"]);
  });
});

describe("resolveRouteCandidate", () => {
  test("経路候補がない場合は ok:false を返す", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(false),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await resolveRouteCandidate({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(false);
  });

  test("候補がある場合は routeId・mode・origin/destinationName・arrivalStationName・所要時間・乗換回数・chosen を返す", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await resolveRouteCandidate({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routeId).toBe("route_origin_destination_easy");
    expect(result.mode).toBe("easy");
    expect(result.originName).toBe("出発駅");
    expect(result.destinationName).toBe("到着駅");
    expect(result.arrivalStationName).toBe("到着駅");
    expect(result.estimatedDurationMinutes).toBe(10);
    expect(result.transferCount).toBe(0);
    expect(result.routeWarnings).toEqual([]);
    expect(result.chosen.segments).toHaveLength(1);
  });

  test("accessible モードで AI 生成ルートしかない場合は確認不能として拒否する", async () => {
    const routeProvider: RouteProviderPort = {
      async findRailRoutes() {
        return [
          {
            originStationId: "origin",
            arrivalStationId: "destination",
            transferCount: 0,
            estimatedDurationMinutes: 20,
            isAiGenerated: true,
            segments: [
              {
                fromStationId: "origin",
                toStationId: "destination",
                line: "テストAI線",
                direction: "到着駅方面",
                platformId: "",
                estimatedMinutes: 20,
              },
            ],
          },
        ];
      },
    };
    const deps: RouteSearchDeps = {
      routeProvider,
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await resolveRouteCandidate({ ...BASE_INPUT, mode: "accessible" }, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("バリアフリー");
  });

  test("AI 生成ルートの場合は routeWarnings に警告文言を含む", async () => {
    const routeProvider: RouteProviderPort = {
      async findRailRoutes() {
        return [
          {
            originStationId: "origin",
            arrivalStationId: "destination",
            transferCount: 0,
            estimatedDurationMinutes: 20,
            isAiGenerated: true,
            segments: [
              {
                fromStationId: "origin",
                toStationId: "destination",
                line: "テストAI線",
                direction: "到着駅方面",
                platformId: "",
                estimatedMinutes: 20,
              },
            ],
          },
        ];
      },
    };
    const deps: RouteSearchDeps = {
      routeProvider,
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await resolveRouteCandidate({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routeWarnings.length).toBeGreaterThan(0);
    expect(result.routeWarnings[0]).toContain("AI");
  });
});

describe("buildTrainSegments", () => {
  test("train 区間ごとに from/to/line/direction/platform/boardingPosition/instruction を組み立てる", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const candidate = await resolveRouteCandidate({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const segments = await buildTrainSegments(candidate.chosen, deps);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: "train",
      from: "出発駅",
      to: "到着駅",
      line: "テスト線",
      direction: "到着駅方面",
      platform: "1",
      boardingPosition: { carNumber: 5, doorPosition: "中央" },
    });
  });

  test("boarding 位置が取得できない場合は unavailable confidence とフォールバック文言を使う", async () => {
    const stationProvider: StationProviderPort = {
      ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
      async getBoardingPosition() {
        return null;
      },
    };
    const deps: RouteSearchDeps = { routeProvider: buildRouteProvider(true), stationProvider };
    const candidate = await resolveRouteCandidate({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const segments = await buildTrainSegments(candidate.chosen, deps);
    expect(segments[0].boardingPosition).toBeNull();
    expect(segments[0].instruction).toContain("号車情報は確認できません");
    expect(segments[0].confidence).toEqual(unavailableConfidence("推奨号車の情報が不足しています"));
  });
});

describe("buildTransferAndExitSegments", () => {
  test("改札・出口・エレベーター情報から transfer/exit セグメントと recommendedExit を構築する", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.transferSegment.type).toBe("transfer");
    expect(outcome.result.exitSegment.type).toBe("exit");
    expect(outcome.result.recommendedExit).toBe("A1出口");
    expect(outcome.result.gate?.name).toBe("中央改札");
    expect(outcome.result.exit?.name).toBe("A1出口");
    expect(outcome.result.elevator?.name).toBe("中央エレベーター");
  });

  test("accessible モードでエレベーター情報が無ければ ok:false を返す", async () => {
    const noElevator = FACILITIES_WITH_ELEVATOR.filter((f) => f.facilityType !== "elevator");
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(noElevator),
    };
    const input = { ...BASE_INPUT, mode: "accessible" as const };
    // accessible モードでも AI 生成でなければ resolveRouteCandidate 自体は成功する
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("バリアフリー");
  });

  test("easy モードではエスカレーターがあればエレベーターより優先して transfer の facilities に使う", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ESCALATOR_AND_ELEVATOR),
    };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.transferSegment.facilities[0]?.facilityType).toBe("escalator");
  });

  describe("目的地座標による出口選定", () => {
    const FAR_EXIT: StationFacility = {
      facilityId: "exit_far",
      stationId: "destination",
      facilityType: "exit",
      name: "遠い出口",
      level: "1F",
      accessible: true,
      coordinates: { lat: 0, lng: 0 },
      connectedGateId: "gate_far",
      confidence: highConfidence,
      verifiedAt: null,
    };
    const NEAR_EXIT: StationFacility = {
      facilityId: "exit_near",
      stationId: "destination",
      facilityType: "exit",
      name: "近い出口",
      level: "1F",
      accessible: true,
      coordinates: { lat: 0.0001, lng: 0.0001 },
      connectedGateId: "gate_near",
      confidence: highConfidence,
      verifiedAt: null,
    };
    const GATE_FAR: StationFacility = {
      facilityId: "gate_far",
      stationId: "destination",
      facilityType: "gate",
      name: "遠い出口側改札",
      level: "1F",
      accessible: true,
      coordinates: null,
      connectedGateId: null,
      confidence: highConfidence,
      verifiedAt: null,
    };
    const GATE_NEAR: StationFacility = {
      facilityId: "gate_near",
      stationId: "destination",
      facilityType: "gate",
      name: "近い出口側改札",
      level: "1F",
      accessible: true,
      coordinates: null,
      connectedGateId: null,
      confidence: highConfidence,
      verifiedAt: null,
    };
    const MULTI_EXIT_FACILITIES = [FAR_EXIT, NEAR_EXIT, GATE_FAR, GATE_NEAR];

    test("目的地座標に最も近い出口を選ぶ(先頭一致ではなく)", async () => {
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider(MULTI_EXIT_FACILITIES),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0.0001, lng: 0.0001 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.exit?.name).toBe("近い出口");
    });

    test("選ばれた出口の connectedGateId から対応する改札を選ぶ", async () => {
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider(MULTI_EXIT_FACILITIES),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0.0001, lng: 0.0001 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.gate?.name).toBe("近い出口側改札");
    });

    test("destinationCoordinates が無ければ従来通り先頭の出口を選ぶ(回帰確認)", async () => {
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider(MULTI_EXIT_FACILITIES),
      };
      const input = { ...BASE_INPUT, mode: "easy" as const, destinationCoordinates: null };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.exit?.name).toBe("遠い出口");
    });

    test("出口の座標が無いデータが混在していても、座標を持つ出口の中から選ぶ", async () => {
      const noCoordExit: StationFacility = {
        ...FAR_EXIT,
        facilityId: "exit_no_coord",
        name: "座標無し出口",
        coordinates: null,
        connectedGateId: null,
      };
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([noCoordExit, NEAR_EXIT, GATE_NEAR]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0.0001, lng: 0.0001 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.exit?.name).toBe("近い出口");
    });

    test("connectedGateId がgate以外のfacilityを指していても、それを改札として返さない(先頭改札にフォールバック)", async () => {
      const exitLinkedToEscalator: StationFacility = {
        ...NEAR_EXIT,
        connectedGateId: "escalator_wrong",
      };
      const wrongTypeFacility: StationFacility = {
        facilityId: "escalator_wrong",
        stationId: "destination",
        facilityType: "escalator",
        name: "誤ってリンクされたエスカレーター",
        level: "1F",
        accessible: true,
        coordinates: null,
        connectedGateId: null,
        confidence: highConfidence,
        verifiedAt: null,
      };
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([
          exitLinkedToEscalator,
          wrongTypeFacility,
          GATE_NEAR,
        ]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0.0001, lng: 0.0001 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.gate?.facilityType).toBe("gate");
      expect(outcome.result.gate?.name).not.toBe("誤ってリンクされたエスカレーター");
    });

    test("connectedGateId が存在しないfacilityIdを指していても、先頭改札にフォールバックする", async () => {
      const exitLinkedToNothing: StationFacility = {
        ...NEAR_EXIT,
        connectedGateId: "gate_does_not_exist",
      };
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([exitLinkedToNothing, GATE_NEAR]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0.0001, lng: 0.0001 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.gate?.name).toBe("近い出口側改札");
    });
  });

  describe("出口データの方角が目的地と大きく異なる場合(方角のみの案内へ格下げ)", () => {
    // 駅中心は STATIONS.destination (lat:0, lng:0)。
    const SOUTH_EXIT: StationFacility = {
      facilityId: "exit_south",
      stationId: "destination",
      facilityType: "exit",
      name: "南口",
      level: "1F",
      accessible: true,
      coordinates: { lat: -0.01, lng: 0 }, // 駅中心から見て真南
      connectedGateId: "gate_south",
      confidence: highConfidence,
      verifiedAt: null,
    };
    const GATE_SOUTH: StationFacility = {
      facilityId: "gate_south",
      stationId: "destination",
      facilityType: "gate",
      name: "南改札",
      level: "1F",
      accessible: true,
      coordinates: null,
      connectedGateId: null,
      confidence: highConfidence,
      verifiedAt: null,
    };
    const EAST_EXIT: StationFacility = {
      facilityId: "exit_east",
      stationId: "destination",
      facilityType: "exit",
      name: "東口",
      level: "1F",
      accessible: true,
      coordinates: { lat: 0, lng: 0.01 }, // 駅中心から見て真東
      connectedGateId: "gate_east",
      confidence: highConfidence,
      verifiedAt: null,
    };
    const GATE_EAST: StationFacility = {
      facilityId: "gate_east",
      stationId: "destination",
      facilityType: "gate",
      name: "東改札",
      level: "1F",
      accessible: true,
      coordinates: null,
      connectedGateId: null,
      confidence: highConfidence,
      verifiedAt: null,
    };

    test("目的地(真北)と唯一の候補出口(真南)の方角が大きくずれる場合、出口を名指しせず方角のみ案内する", async () => {
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([SOUTH_EXIT, GATE_SOUTH]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0.01, lng: 0 }, // 駅中心から見て真北
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.exit).toBeNull();
      expect(outcome.result.gate).toBeNull();
      expect(outcome.result.recommendedExit).toContain("北");
      expect(outcome.result.exitSegment.instruction).toContain("北");
      expect(outcome.result.exitSegment.instruction).not.toContain("南口");
      expect(outcome.result.exitSegment.confidence.level).toBe("low");
      expect(outcome.result.transferSegment.instruction).not.toContain("南改札");
    });

    test("目的地と候補出口の方角がほぼ一致する場合は、引き続き具体的な出口を案内する(閾値内は従来通り)", async () => {
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([EAST_EXIT, GATE_EAST]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0, lng: 0.01 }, // 出口と同じく真東
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.exit?.name).toBe("東口");
      expect(outcome.result.gate?.name).toBe("東改札");
    });

    test("候補出口が全て座標を持たない場合も、目的地座標があれば先頭一致で断定せず方角のみ案内する", async () => {
      const noCoordExit: StationFacility = {
        ...SOUTH_EXIT,
        facilityId: "exit_no_coord",
        name: "座標無し出口",
        coordinates: null,
        connectedGateId: null,
      };
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([noCoordExit]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0.01, lng: 0 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.exit).toBeNull();
      expect(outcome.result.exitSegment.instruction).not.toContain("座標無し出口");
      expect(outcome.result.exitSegment.confidence.level).toBe("low");
    });

    test("目的地座標はあるが到着駅自体の座標が取得できない場合、方角を判定できないため先頭一致で断定せず出口を確認不能とする(クラッシュしない)", async () => {
      const baseProvider = buildStationProvider([SOUTH_EXIT, GATE_SOUTH]);
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: {
          ...baseProvider,
          async getStation(stationId: string) {
            if (stationId === "destination") return null;
            return STATIONS[stationId] ?? null;
          },
        },
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: { lat: 0.01, lng: 0 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.exit).toBeNull();
      expect(outcome.result.gate).toBeNull();
      expect(outcome.result.exitSegment.instruction).toBe("出口情報を確認できません。");
    });

    test("目的地が駅からごく近い場合は方角判定が数学的に不安定になるためスキップし、座標ベースの最近傍選定を使う", async () => {
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([SOUTH_EXIT, GATE_SOUTH, EAST_EXIT, GATE_EAST]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        // 駅中心(0,0)から見て極めて近い(方角が数学的に不安定になる距離)
        destinationCoordinates: { lat: 0.00001, lng: 0.00001 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      // 方角チェックをスキップした結果、単純に座標が最も近い出口(東口)が選ばれる
      expect(outcome.result.exit?.name).toBe("東口");
    });
  });
});

describe("computeConfidenceSummary", () => {
  test("trainSegments と facilities から各区分の confidence を集約する", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const trainSegments = await buildTrainSegments(candidate.chosen, deps);
    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const summary = computeConfidenceSummary(trainSegments, outcome.result, "easy");
    expect(summary.boardingPosition).toBe("high");
    expect(summary.transferGuide).toBe("high");
    expect(summary.gate).toBe("high");
    expect(summary.exit).toBe("high");
    expect(summary.accessibility).toBeNull();
  });

  test("accessible モードではエレベーターの confidence を accessibility に設定する", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const input = { ...BASE_INPUT, mode: "accessible" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const trainSegments = await buildTrainSegments(candidate.chosen, deps);
    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const summary = computeConfidenceSummary(trainSegments, outcome.result, "accessible");
    expect(summary.accessibility).toBe("high");
  });
});

describe("computeKeyInstruction", () => {
  test("号車・改札・出口情報から案内文言を組み立てる", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const trainSegments = await buildTrainSegments(candidate.chosen, deps);
    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const keyInstruction = computeKeyInstruction(trainSegments, outcome.result);
    expect(keyInstruction.text).toBe("5号車付近に乗車、中央改札、A1出口へ。");
  });

  test("号車・改札・出口情報が無い場合はフォールバック文言を使う", async () => {
    const stationProvider: StationProviderPort = {
      ...buildStationProvider([]),
      async getBoardingPosition() {
        return null;
      },
    };
    const deps: RouteSearchDeps = { routeProvider: buildRouteProvider(true), stationProvider };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const trainSegments = await buildTrainSegments(candidate.chosen, deps);
    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const keyInstruction = computeKeyInstruction(trainSegments, outcome.result);
    expect(keyInstruction.text).toBe("乗車位置は確認できません、改札は確認できません、出口は確認できません。");
  });
});
