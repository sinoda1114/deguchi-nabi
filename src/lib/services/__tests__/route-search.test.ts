import { describe, expect, test } from "vitest";
import { searchRouteGuide } from "@/lib/services/route-search";
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
