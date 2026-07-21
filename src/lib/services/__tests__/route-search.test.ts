import { describe, expect, test, vi } from "vitest";
import {
  searchRouteGuide,
  resolveRouteCandidate,
  buildTrainSegments,
  buildTransferAndExitSegments,
  computeConfidenceSummary,
  computeKeyInstruction,
  sortCandidatesByMode,
  NO_DEPARTURE_TIME_DISCLAIMER,
} from "@/lib/services/route-search";
import type { RouteSearchDeps, UnifiedBoardingPosition } from "@/lib/services/route-search";
import type { RouteProviderPort } from "@/lib/integrations/route-provider/RouteProviderPort";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import type {
  BoardingPosition,
  Coordinates,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";
import { unavailableConfidence, type Confidence } from "@/lib/domain/confidence";
import { haversineMeters } from "@/lib/geo/haversine";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

const mediumConfidence: Confidence = {
  level: "medium",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 1,
};

const lowConfidenceValue: Confidence = {
  level: "low",
  reasons: ["Web検索結果のみで裏付けが弱い"],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 1,
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

  test("easy モードで到着駅のarrivalGuideにticket_gate/street_exitステップを含む", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await searchRouteGuide({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route.arrivalGuide?.steps.map((s) => s.type)).toEqual([
      "ticket_gate",
      "street_exit",
    ]);
  });

  /**
   * 回帰テスト: 「西谷駅→バーガーキング相鉄横浜駅店」で実際に発生した不具合
   * (改札名が一度も表示されず、方角(南側等)が出口名の代わりに表示される)を
   * 再現する。改札外の目的地座標を出口の直近に設定し、gate/exitが両方
   * 確定するケース(実際の相鉄横浜駅のような大規模駅を模したテストデータ)で、
   * 改札ステップが理由なく省略されないこと・方角が名称の代用にならないことを
   * 固定する。実在の横浜駅fixtureそのものは追加せず、既存のテスト用抽象駅
   * データ("destination")にこのシナリオ専用のgate/exitを与える形で表現する
   * (このファイルの他のテストと同じ抽象化レベルに揃え、実データ整備という
   * 別軸の作業を本バグ修正のスコープに含めないため)。
   */
  test("回帰: 改札外の大規模駅目的地(西谷→バーガーキング相鉄横浜駅店で発生した事象)で改札・出口ステップを理由なく省略せず、方角を名称の代わりに使わない", async () => {
    const gate: StationFacility = {
      facilityId: "gate_yokohama_like",
      stationId: "destination",
      facilityType: "gate",
      name: "西口改札",
      level: "1F",
      accessible: true,
      coordinates: { lat: 0, lng: 0 },
      connectedGateId: null,
      confidence: highConfidence,
      verifiedAt: null,
    };
    const exit: StationFacility = {
      facilityId: "exit_yokohama_like",
      stationId: "destination",
      facilityType: "exit",
      name: "西口",
      level: "1F",
      accessible: true,
      coordinates: { lat: 0, lng: 0 },
      connectedGateId: "gate_yokohama_like",
      confidence: highConfidence,
      verifiedAt: null,
    };
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider([gate, exit]),
    };
    const result = await searchRouteGuide(
      { ...BASE_INPUT, mode: "easy", destinationCoordinates: { lat: 0, lng: 0 } },
      deps
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.route.arrivalGuide?.steps.map((s) => s.type)).toEqual([
      "ticket_gate",
      "street_exit",
    ]);
    expect(result.route.arrivalGuide?.steps[0].title).toBe("西口改札");
    expect(result.route.arrivalGuide?.steps[1].title).toBe("西口");
    expect(result.route.summary.recommendedExit).toBe("西口");
    // 方角(◯◯側)が出口名の代わりに使われていないことを固定する
    expect(result.route.summary.recommendedExit).not.toMatch(/側$/);
    expect(result.route.keyInstruction.text).not.toContain("改札を出て");
    expect(result.route.keyInstruction.text).toContain("西口改札");
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

  test("AI生成ルート(platformId空)でも stationId/line/direction で号車情報を取得する", async () => {
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

  test("warnings に出発時刻未指定の免責文言を常に含む", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await searchRouteGuide({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route.warnings).toContain(NO_DEPARTURE_TIME_DISCLAIMER);
  });

  test("walkingDistanceMeters に到着駅座標と目的地座標から算出した近似値が入る", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const destinationCoordinates: Coordinates = { lat: 0.001, lng: 0.001 };
    const result = await searchRouteGuide(
      { ...BASE_INPUT, mode: "easy", destinationCoordinates },
      deps
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 到着駅(STATIONS.destination)は lat:0, lng:0
    const expected = haversineMeters(0, 0, destinationCoordinates.lat, destinationCoordinates.lng);
    expect(result.route.summary.walkingDistanceMeters).toBeCloseTo(expected, 5);
  });

  test("destinationCoordinates が無い場合は walkingDistanceMeters が null のまま", async () => {
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider(FACILITIES_WITH_ELEVATOR),
    };
    const result = await searchRouteGuide(
      { ...BASE_INPUT, mode: "easy", destinationCoordinates: null },
      deps
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route.summary.walkingDistanceMeters).toBeNull();
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
    // AI生成でない通常の経路でも、出発時刻未指定の免責文言は常に含まれる。
    expect(result.routeWarnings).toEqual([NO_DEPARTURE_TIME_DISCLAIMER]);
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
    // 出発時刻未指定の免責文言は、AI生成警告と併存して常に含まれる。
    expect(result.routeWarnings).toContain(NO_DEPARTURE_TIME_DISCLAIMER);
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

  test("unifiedBoardingPositionが渡された場合、到着駅直前の区間ではそれをそのまま採用し独立した乗車位置生成(getBoardingPosition)は呼ばない(統合生成が選んだ改札と矛盾しない号車にするため。2026-07-20 fix/unified-guide-boarding-and-operator-disambiguation)", async () => {
    const getBoardingPositionSpy = vi.fn(async () => null);
    const stationProvider: StationProviderPort = {
      ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
      getBoardingPosition: getBoardingPositionSpy,
    };
    const deps: RouteSearchDeps = { routeProvider: buildRouteProvider(true), stationProvider };
    const candidate = await resolveRouteCandidate({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const unifiedBoardingPosition: UnifiedBoardingPosition = {
      carNumber: 6,
      doorPosition: "後方",
      reason: "1階改札への階段に近いため",
      confidence: highConfidence,
    };
    const segments = await buildTrainSegments(candidate.chosen, deps, unifiedBoardingPosition);

    expect(getBoardingPositionSpy).not.toHaveBeenCalled();
    expect(segments[0].boardingPosition).toEqual({
      carNumber: 6,
      doorPosition: "後方",
      reason: "1階改札への階段に近いため",
    });
    expect(segments[0].confidence).toBe(highConfidence);
  });

  test("unifiedBoardingPositionがnullの場合、従来通り独立した乗車位置生成(getBoardingPosition)を呼ぶ", async () => {
    const getBoardingPositionSpy = vi.fn(async () => null);
    const stationProvider: StationProviderPort = {
      ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
      getBoardingPosition: getBoardingPositionSpy,
    };
    const deps: RouteSearchDeps = { routeProvider: buildRouteProvider(true), stationProvider };
    const candidate = await resolveRouteCandidate({ ...BASE_INPUT, mode: "easy" }, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    await buildTrainSegments(candidate.chosen, deps, null);

    expect(getBoardingPositionSpy).toHaveBeenCalledTimes(1);
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

  test("DESTINATION_HINT_ENABLED=1かつ目的地がplace由来(destinationCoordinatesあり)の場合、getFacilitiesにdestinationLabelをヒントとして渡す(検証ゲート通過まではフラグOFFが既定。フラグON時の配線自体は維持する)", async () => {
    vi.stubEnv("DESTINATION_HINT_ENABLED", "1");
    try {
      const getFacilitiesSpy = vi.fn(async () => FACILITIES_WITH_ELEVATOR);
      const stationProvider: StationProviderPort = {
        ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
        getFacilities: getFacilitiesSpy,
      };
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider,
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationLabel: "テストカフェ",
        destinationCoordinates: { lat: 35.1, lng: 136.2 },
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      await buildTransferAndExitSegments(candidate, input, deps);

      expect(getFacilitiesSpy).toHaveBeenCalledWith("destination", "テストカフェ");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("目的地が駅そのもの(destinationCoordinatesなし)の場合、getFacilitiesにヒントを渡さない", async () => {
    const getFacilitiesSpy = vi.fn(async () => FACILITIES_WITH_ELEVATOR);
    const stationProvider: StationProviderPort = {
      ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
      getFacilities: getFacilitiesSpy,
    };
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider,
    };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    await buildTransferAndExitSegments(candidate, input, deps);

    expect(getFacilitiesSpy).toHaveBeenCalledWith("destination", null);
  });

  test("DESTINATION_HINT_ENABLED未設定(既定OFF)の場合、目的地がplace由来でもgetFacilitiesにヒントを渡さない(E2E検証でhint有りが駅全体検索より劣化することを確認したため、検証ゲート通過までデフォルトOFFで止血する。/council議論参照)", async () => {
    const getFacilitiesSpy = vi.fn(async () => FACILITIES_WITH_ELEVATOR);
    const stationProvider: StationProviderPort = {
      ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
      getFacilities: getFacilitiesSpy,
    };
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider,
    };
    const input = {
      ...BASE_INPUT,
      mode: "easy" as const,
      destinationLabel: "テストカフェ",
      destinationCoordinates: { lat: 35.1, lng: 136.2 },
    };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    await buildTransferAndExitSegments(candidate, input, deps);

    expect(getFacilitiesSpy).toHaveBeenCalledWith("destination", null);
  });

  test("easyモードかつ経路が非AI生成の場合、統合生成(getUnifiedArrivalGuide)を試し結果を採用する(council議論2026-07-20)", async () => {
    const getUnifiedArrivalGuide = vi.fn(async () => ({
      boardingPosition: null,
      gate: { name: "統合生成改札", confidence: highConfidence },
      exit: { name: "統合生成出口", confidence: highConfidence },
      walkingSteps: [
        {
          type: "public_passage" as const,
          title: "見出し",
          instruction: "改札を出て直進してください。",
          landmarks: [],
          confidence: highConfidence,
          provenance: "ai_inferred" as const,
        },
      ],
    }));
    const stationProvider: StationProviderPort = {
      ...buildStationProvider([]),
      getUnifiedArrivalGuide,
    };
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider,
    };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(getUnifiedArrivalGuide).toHaveBeenCalledWith(
      "destination",
      "到着駅",
      "テスト鉄道",
      ["テスト線"],
      "出発駅",
      "テスト線",
      "到着駅方面",
      null,
      { lat: 0, lng: 0 },
      null
    );
    expect(outcome.result.gate?.name).toBe("統合生成改札");
    expect(outcome.result.exit?.name).toBe("統合生成出口");
    expect(outcome.result.hasApproximateGuidance).toBe(false);
    expect(outcome.result.arrivalGuide.steps.some((s) => s.title === "見出し")).toBe(true);
  });

  test("accessibleモードでは統合生成を呼ばない(既存のエレベーター確認ロジックを優先)", async () => {
    const getUnifiedArrivalGuide = vi.fn();
    const stationProvider: StationProviderPort = {
      ...buildStationProvider(FACILITIES_WITH_ELEVATOR),
      getUnifiedArrivalGuide,
    };
    const deps: RouteSearchDeps = { routeProvider: buildRouteProvider(true), stationProvider };
    const input = { ...BASE_INPUT, mode: "accessible" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    await buildTransferAndExitSegments(candidate, input, deps);

    expect(getUnifiedArrivalGuide).not.toHaveBeenCalled();
  });

  test("経路自体がAI生成の場合でも統合生成を呼ぶ(fixture外ルートは経路自体がAI生成になるため、ここを止めると常に「確認できません」に落ちる。IPレートリミットで総リクエスト数は上限があるため、1リクエストあたりのAI呼び出しが最大2系統になるコスト増は許容する)", async () => {
    const getUnifiedArrivalGuide = vi.fn(async () => ({
      boardingPosition: null,
      gate: { name: "統合生成改札", confidence: highConfidence },
      exit: { name: "統合生成出口", confidence: highConfidence },
      walkingSteps: [],
    }));
    const stationProvider: StationProviderPort = {
      ...buildStationProvider([]),
      getUnifiedArrivalGuide,
    };
    const routeProvider: RouteProviderPort = {
      async findRailRoutes() {
        return [
          {
            originStationId: "origin",
            arrivalStationId: "destination",
            transferCount: 0,
            estimatedDurationMinutes: 10,
            isAiGenerated: true,
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
    const deps: RouteSearchDeps = { routeProvider, stationProvider };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const outcome = await buildTransferAndExitSegments(candidate, input, deps);

    expect(getUnifiedArrivalGuide).toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.exit?.name).toBe("統合生成出口");
  });

  test("統合生成がnullを返した場合は旧方式(getFacilities)へフォールバックせず確認不能のまま返す(/security-review指摘、Medium: フォールバックすると1リクエストで統合生成+旧方式の計4回の課金AI呼び出しが発生しレートリミットの実効性が下がるため)", async () => {
    const getUnifiedArrivalGuide = vi.fn(async () => null);
    const getFacilities = vi.fn(async () => []);
    const stationProvider: StationProviderPort = {
      ...buildStationProvider([]),
      getUnifiedArrivalGuide,
      getFacilities,
    };
    const deps: RouteSearchDeps = { routeProvider: buildRouteProvider(true), stationProvider };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.exit).toBeNull();
    expect(outcome.result.gate).toBeNull();
    expect(getFacilities).not.toHaveBeenCalled();
  });

  test("統合生成が出口を確認できなかった場合(gateのみ、または両方null)は、部分結果を「確認済み」扱いせず、かつ旧方式(getFacilities)へもフォールバックしない(/ai-review再指摘、Medium: exit未確認をexact tierとして誤判定しない。/security-review指摘、Medium: 課金AI呼び出しの二重発生を避ける)", async () => {
    const getUnifiedArrivalGuide = vi.fn(async () => ({
      boardingPosition: null,
      gate: { name: "統合生成改札", confidence: highConfidence },
      exit: null,
      walkingSteps: [],
    }));
    const getFacilities = vi.fn(async () => []);
    const stationProvider: StationProviderPort = {
      ...buildStationProvider([]),
      getUnifiedArrivalGuide,
      getFacilities,
    };
    const deps: RouteSearchDeps = { routeProvider: buildRouteProvider(true), stationProvider };
    const input = { ...BASE_INPUT, mode: "easy" as const };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;

    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // 統合生成のgateだけの部分結果は採用しない。旧方式(getFacilities)へも
    // フォールバックしないため確認不能のままになる。
    expect(outcome.result.exit).toBeNull();
    expect(outcome.result.gate).toBeNull();
    expect(outcome.result.hasApproximateGuidance).toBe(false);
    expect(getFacilities).not.toHaveBeenCalled();
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
      // 具体的な出口が確認できない場合、方角(北)を出口名の代わりに使わず
      // 「確認できません」と明示する(ユーザーフィードバックに基づく変更)。
      // 方角自体は hasApproximateGuidance/approximateDirectionLabel として
      // 引き続き独立に保持する(下のアサーション参照)。
      expect(outcome.result.recommendedExit).toBe("確認できません");
      expect(outcome.result.exitSegment.instruction).toBe("出口は確認できません。");
      expect(outcome.result.exitSegment.instruction).not.toContain("南口");
      // 出口自体が未確認(実在するかどうか未確認)なので unavailable として扱う
      // (「確認不能」をlowとして扱わない設計変更。低いのは検証度ではなく
      // 実在確認そのものができていないため)。
      expect(outcome.result.exitSegment.confidence.level).toBe("unavailable");
      expect(outcome.result.transferSegment.instruction).not.toContain("南改札");
      // 「現地でご確認ください」等の弱気な文言をsegment単位で繰り返さない
      // (信頼を損ねるとのフィードバックを受け、断定的な文言+ページ全体で
      // 1回だけの注記(hasApproximateGuidance)に統一した)。
      expect(outcome.result.exitSegment.instruction).not.toContain("現地");
      expect(outcome.result.transferSegment.instruction).not.toContain("現地");
      expect(outcome.result.exitSegment.warnings).toEqual([]);
      expect(outcome.result.hasApproximateGuidance).toBe(true);
      expect(outcome.result.approximateDirectionLabel).toBe("北");
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
      expect(outcome.result.hasApproximateGuidance).toBe(false);
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
      expect(outcome.result.exitSegment.confidence.level).toBe("unavailable");
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
      expect(outcome.result.exitSegment.instruction).toBe("出口は確認できません。");
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

  // 実機検証(西谷駅→kawara CAFE&DINING横浜店)で、目的地出口検索パイプラインが
  // confidence "low"の出口を返した際、confidenceベースの表示ゲートが原因で
  // 改札・出口情報の大半が「確認できません」表示になり、ユーザーから強い
  // 不満が出た。第三者レビューを受け、「隠す」のではなく「存在する情報は
  // 必ず出し、確度が高くなければ注記(未確認情報)で伝える」設計に転換した。
  // exitSegment/transferSegmentとも、exit/gateが実在する限りconfidenceで
  // 隠さず、confidenceが"high"未満の場合のみinstructionに注記を付ける回帰テスト。
  describe("出口・改札のconfidenceによる注記付与(隠さない設計への転換、回帰テスト)", () => {
    // 方角格下げ(resolveExitRecommendationのbearingチェック)を発生させないため、
    // 出口座標とdestinationCoordinatesを完全に一致させる(EAST_EXITと同じ手法)。
    const EXIT_COORDINATES: Coordinates = { lat: 0, lng: 0.01 };

    function buildExitFacility(confidence: Confidence): StationFacility {
      return {
        facilityId: "exit_conf_gate_test",
        stationId: "destination",
        facilityType: "exit",
        name: "相鉄口",
        level: "1F",
        accessible: true,
        coordinates: EXIT_COORDINATES,
        connectedGateId: "gate_conf_gate_test",
        confidence,
        verifiedAt: null,
      };
    }

    function buildGateFacility(confidence: Confidence): StationFacility {
      return {
        facilityId: "gate_conf_gate_test",
        stationId: "destination",
        facilityType: "gate",
        name: "テスト改札",
        level: "1F",
        accessible: true,
        coordinates: null,
        connectedGateId: null,
        confidence,
        verifiedAt: null,
      };
    }

    const GATE_FOR_CONF_TEST = buildGateFacility(highConfidence);

    test("confidenceがlowの出口は、隠さず表示した上でinstructionに出口名と「未確認情報」の両方を含める", async () => {
      const lowExit = buildExitFacility(lowConfidenceValue);
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([lowExit, GATE_FOR_CONF_TEST]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: EXIT_COORDINATES,
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      // 出口自体は実在が確認できている(座標一致・low confidence)ため、
      // exit変数自体はnullにしない。confidenceSummary.exit等が「実在するが
      // 検証度が低い」を正しく表せるようにするため、実際のconfidenceを保持する
      // (unavailableへ格上げしない)。
      expect(outcome.result.exit?.name).toBe("相鉄口");
      expect(outcome.result.exit?.confidence.level).toBe("low");

      // 隠さず出口名を表示し、confidenceが"high"未満のため注記を付ける。
      expect(outcome.result.exitSegment.instruction).toContain("相鉄口");
      expect(outcome.result.exitSegment.instruction).toContain("未確認情報");
      expect(outcome.result.exitSegment.instruction).not.toBe("出口は確認できません。");
      expect(outcome.result.exitSegment.facilities).toEqual([
        { facilityType: "exit", name: "相鉄口", confidence: lowConfidenceValue },
      ]);

      // exitSegment.confidence自体は実際の値(low)を維持する。
      expect(outcome.result.exitSegment.confidence.level).toBe("low");
    });

    test("confidenceがmediumの出口も、隠さず表示した上でinstructionに「未確認情報」の注記を付ける", async () => {
      const mediumExit = buildExitFacility(mediumConfidence);
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([mediumExit, GATE_FOR_CONF_TEST]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: EXIT_COORDINATES,
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.exitSegment.instruction).toContain("相鉄口");
      expect(outcome.result.exitSegment.instruction).toContain("未確認情報");
      expect(outcome.result.exitSegment.facilities).toEqual([
        { facilityType: "exit", name: "相鉄口", confidence: mediumConfidence },
      ]);
    });

    test("confidenceがhighの出口は、従来通りexitSegmentに名前を表示し、注記は付けない(既存の正常系)", async () => {
      const highExit = buildExitFacility(highConfidence);
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([highExit, GATE_FOR_CONF_TEST]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: EXIT_COORDINATES,
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.exitSegment.instruction).toBe("相鉄口から出てください。");
      expect(outcome.result.exitSegment.instruction).not.toContain("未確認情報");
      expect(outcome.result.exitSegment.facilities).toEqual([
        { facilityType: "exit", name: "相鉄口", confidence: highConfidence },
      ]);
    });

    test("出口がnull(元から確認できていない)場合は従来通り「出口は確認できません。」のまま(既存分岐の維持)", async () => {
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([]),
      };
      const input = { ...BASE_INPUT, mode: "easy" as const };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.exit).toBeNull();
      expect(outcome.result.exitSegment.instruction).toBe("出口は確認できません。");
      expect(outcome.result.exitSegment.facilities).toEqual([]);
      expect(outcome.result.exitSegment.confidence.level).toBe("unavailable");
    });

    test("confidenceがlowの改札は、隠さず表示した上でinstructionに改札名と「未確認情報」の両方を含める", async () => {
      const highExitForGateTest = buildExitFacility(highConfidence);
      const lowGate = buildGateFacility(lowConfidenceValue);
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([highExitForGateTest, lowGate]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: EXIT_COORDINATES,
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.gate?.name).toBe("テスト改札");
      expect(outcome.result.gate?.confidence.level).toBe("low");
      expect(outcome.result.transferSegment.instruction).toContain("テスト改札");
      expect(outcome.result.transferSegment.instruction).toContain("未確認情報");
      // transferSegment.confidence自体は実際の値(low)を維持する。
      expect(outcome.result.transferSegment.confidence.level).toBe("low");
    });

    test("confidenceがhighの改札は、従来通りtransferSegmentに名前を表示し、注記は付けない", async () => {
      const highExitForGateTest = buildExitFacility(highConfidence);
      const deps: RouteSearchDeps = {
        routeProvider: buildRouteProvider(true),
        stationProvider: buildStationProvider([highExitForGateTest, GATE_FOR_CONF_TEST]),
      };
      const input = {
        ...BASE_INPUT,
        mode: "easy" as const,
        destinationCoordinates: EXIT_COORDINATES,
      };
      const candidate = await resolveRouteCandidate(input, deps);
      expect(candidate.ok).toBe(true);
      if (!candidate.ok) return;

      const outcome = await buildTransferAndExitSegments(candidate, input, deps);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.result.transferSegment.instruction).toBe("テスト改札へ向かってください。");
      expect(outcome.result.transferSegment.instruction).not.toContain("未確認情報");
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

  test("出口が方角のみ判明している場合、「確認できません」を明示しつつ推奨方向を別途付記する(方角を出口名の代わりにしない)", async () => {
    const SOUTH_EXIT: StationFacility = {
      facilityId: "exit_south",
      stationId: "destination",
      facilityType: "exit",
      name: "南口",
      level: "1F",
      accessible: true,
      coordinates: { lat: -0.01, lng: 0 },
      connectedGateId: "gate_south",
      confidence: highConfidence,
      verifiedAt: null,
    };
    const deps: RouteSearchDeps = {
      routeProvider: buildRouteProvider(true),
      stationProvider: buildStationProvider([SOUTH_EXIT]),
    };
    const input = {
      ...BASE_INPUT,
      mode: "easy" as const,
      destinationCoordinates: { lat: 0.01, lng: 0 }, // 駅中心から見て真北(南口とは方角が大きくずれる)
    };
    const candidate = await resolveRouteCandidate(input, deps);
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const trainSegments = await buildTrainSegments(candidate.chosen, deps);
    const outcome = await buildTransferAndExitSegments(candidate, input, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const keyInstruction = computeKeyInstruction(trainSegments, outcome.result);
    expect(keyInstruction.text).toContain("出口は確認できません(推奨方向: 北側)");
  });
});

describe("sortCandidatesByMode", () => {
  const DESTINATION: Coordinates = { lat: 0, lng: 0 };

  interface Candidate {
    id: string;
    transferCount: number;
    estimatedDurationMinutes: number;
    arrivalStationCoordinates?: Coordinates | null;
  }

  function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
    return {
      id,
      transferCount: 0,
      estimatedDurationMinutes: 10,
      arrivalStationCoordinates: null,
      ...overrides,
    };
  }

  test("easy: 乗換回数が少ない候補を優先する", () => {
    const fewTransfers = candidate("few", { transferCount: 0, estimatedDurationMinutes: 30 });
    const manyTransfers = candidate("many", { transferCount: 2, estimatedDurationMinutes: 5 });
    const sorted = sortCandidatesByMode([manyTransfers, fewTransfers], "easy", null);
    expect(sorted[0].id).toBe("few");
  });

  test("easy: 乗換回数が同じ場合、所要時間の差が閾値を超えれば所要時間の短い候補を優先する", () => {
    const slow = candidate("slow", { transferCount: 0, estimatedDurationMinutes: 30 });
    const fast = candidate("fast", { transferCount: 0, estimatedDurationMinutes: 10 });
    const sorted = sortCandidatesByMode([slow, fast], "easy", null);
    expect(sorted[0].id).toBe("fast");
  });

  test("easy: 乗換回数・所要時間(閾値内)が同程度の場合、徒歩距離(近似)が短い候補を優先する", () => {
    const near = candidate("near", {
      transferCount: 0,
      estimatedDurationMinutes: 10,
      arrivalStationCoordinates: { lat: 0.0001, lng: 0.0001 },
    });
    const far = candidate("far", {
      transferCount: 0,
      estimatedDurationMinutes: 11, // 差1分(閾値5分以内なので「同程度」)
      arrivalStationCoordinates: { lat: 0.01, lng: 0.01 },
    });
    const sorted = sortCandidatesByMode([far, near], "easy", DESTINATION);
    expect(sorted[0].id).toBe("near");
  });

  test("easy: 所要時間の差が閾値を超える場合は、徒歩距離が近くても所要時間の短さを優先する", () => {
    const shortDurationFarWalk = candidate("short_duration_far_walk", {
      transferCount: 0,
      estimatedDurationMinutes: 5,
      arrivalStationCoordinates: { lat: 0.01, lng: 0.01 },
    });
    const longDurationNearWalk = candidate("long_duration_near_walk", {
      transferCount: 0,
      estimatedDurationMinutes: 20, // 差15分(閾値超え)
      arrivalStationCoordinates: { lat: 0.0001, lng: 0.0001 },
    });
    const sorted = sortCandidatesByMode(
      [longDurationNearWalk, shortDurationFarWalk],
      "easy",
      DESTINATION
    );
    expect(sorted[0].id).toBe("short_duration_far_walk");
  });

  test("fastest: 所要時間を最優先する(乗換回数が多くても所要時間が短ければ優先)", () => {
    const fastButManyTransfers = candidate("fast_many_transfers", {
      transferCount: 2,
      estimatedDurationMinutes: 10,
    });
    const slowButFewTransfers = candidate("slow_few_transfers", {
      transferCount: 0,
      estimatedDurationMinutes: 25,
    });
    const sorted = sortCandidatesByMode(
      [slowButFewTransfers, fastButManyTransfers],
      "fastest",
      null
    );
    expect(sorted[0].id).toBe("fast_many_transfers");
  });

  test("fastest: 所要時間が同程度の場合、乗換回数の少ない候補を優先する", () => {
    const oneTransfer = candidate("one_transfer", {
      transferCount: 1,
      estimatedDurationMinutes: 10,
    });
    const noTransfer = candidate("no_transfer", {
      transferCount: 0,
      estimatedDurationMinutes: 11, // 差1分(同程度)
    });
    const sorted = sortCandidatesByMode([oneTransfer, noTransfer], "fastest", null);
    expect(sorted[0].id).toBe("no_transfer");
  });

  test("fastest: 所要時間・乗換回数が同程度の場合、徒歩距離(近似)が短い候補を優先する", () => {
    const near = candidate("near", {
      transferCount: 0,
      estimatedDurationMinutes: 10,
      arrivalStationCoordinates: { lat: 0.0001, lng: 0.0001 },
    });
    const far = candidate("far", {
      transferCount: 0,
      estimatedDurationMinutes: 11,
      arrivalStationCoordinates: { lat: 0.01, lng: 0.01 },
    });
    const sorted = sortCandidatesByMode([far, near], "fastest", DESTINATION);
    expect(sorted[0].id).toBe("near");
  });

  test("destinationCoordinates が null の場合は徒歩距離比較をスキップし、元の順序を維持する(安定ソート)", () => {
    const a = candidate("a", {
      transferCount: 0,
      estimatedDurationMinutes: 10,
      arrivalStationCoordinates: { lat: 0.0001, lng: 0.0001 },
    });
    const b = candidate("b", {
      transferCount: 0,
      estimatedDurationMinutes: 11,
      arrivalStationCoordinates: { lat: 0.01, lng: 0.01 },
    });
    const sorted = sortCandidatesByMode([a, b], "easy", null);
    expect(sorted.map((c) => c.id)).toEqual(["a", "b"]);
  });

  test("到着駅座標を持たない候補が混在する場合も徒歩距離比較をスキップする(クラッシュしない)", () => {
    const withCoordinates = candidate("with_coordinates", {
      transferCount: 0,
      estimatedDurationMinutes: 10,
      arrivalStationCoordinates: { lat: 0.0001, lng: 0.0001 },
    });
    const withoutCoordinates = candidate("without_coordinates", {
      transferCount: 0,
      estimatedDurationMinutes: 11,
      arrivalStationCoordinates: null,
    });
    const sorted = sortCandidatesByMode(
      [withCoordinates, withoutCoordinates],
      "easy",
      DESTINATION
    );
    expect(sorted.map((c) => c.id)).toEqual(["with_coordinates", "without_coordinates"]);
  });

  test("回帰: 所要時間の同程度判定はペアごとの比較ではなく区間の基準値で行い、入力順序が変わっても結果が一定になる(推移律)", () => {
    // A(10分/300m)・B(14分/200m)・C(18分/100m)は同じ乗換回数。
    // ペアごとに「差が5分以内なら同着」と判定すると、A~B(差4)、B~C(差4)は
    // 同着だがA・C(差8)は同着にならず、A<C<B<A のような循環が生じ、
    // Array.prototype.sort に渡す比較関数が推移的でなくなる(入力順序に
    // よって結果が変わる不具合)。sortCandidatesByModeは区間の基準値
    // (昇順に並べた区間の先頭の値)からの差で同着を判定するため、
    // 入力の並び順によらず常に同じ結果になることを固定する。
    const a = candidate("a", {
      transferCount: 0,
      estimatedDurationMinutes: 10,
      arrivalStationCoordinates: { lat: 0.003, lng: 0 }, // 徒歩距離: 遠い
    });
    const b = candidate("b", {
      transferCount: 0,
      estimatedDurationMinutes: 14,
      arrivalStationCoordinates: { lat: 0.002, lng: 0 }, // 徒歩距離: 中間
    });
    const c = candidate("c", {
      transferCount: 0,
      estimatedDurationMinutes: 18,
      arrivalStationCoordinates: { lat: 0.001, lng: 0 }, // 徒歩距離: 近い
    });

    const permutations = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];

    const results = permutations.map((perm) =>
      sortCandidatesByMode(perm, "easy", DESTINATION).map((x) => x.id)
    );

    // 全ての入力順序で結果が一致すること(=特定の入力順序でのみ発生する
    // 循環的な並び替えが起きていないこと)を固定する。
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });
});
