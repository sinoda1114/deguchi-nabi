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
    coordinates: null,
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
    coordinates: null,
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
    coordinates: null,
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
    coordinates: null,
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
