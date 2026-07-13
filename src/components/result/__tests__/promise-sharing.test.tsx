import { describe, expect, test, vi } from "vitest";
import {
  buildTrainSegments,
  buildTransferAndExitSegments,
  type RouteCandidateResult,
} from "@/lib/services/route-search";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import type { BoardingPosition, Platform, Station, StationFacility } from "@/lib/domain/station";
import type { RailRouteCandidate } from "@/lib/integrations/route-provider/RouteProviderPort";
import { type Confidence } from "@/lib/domain/confidence";
import { RouteOverviewContent } from "@/components/result/RouteOverviewContent";
import { FacilitiesWarningBadges } from "@/components/result/FacilitiesWarningBadges";
import { RouteTimelineDiagramSection } from "@/components/result/RouteTimelineDiagramSection";
import { RouteDiagramSection } from "@/components/result/RouteDiagramSection";
import { ConfidenceSummarySection } from "@/components/result/ConfidenceSummarySection";

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

const CHOSEN: RailRouteCandidate = {
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
};

const CANDIDATE: RouteCandidateResult = {
  ok: true,
  routeId: "route_origin_destination_easy",
  mode: "easy",
  originName: "出発駅",
  destinationName: "到着駅",
  arrivalStationName: "到着駅",
  arrivalStationCoordinates: null,
  estimatedDurationMinutes: 10,
  transferCount: 0,
  routeWarnings: [],
  chosen: CHOSEN,
};

const SEARCH_INPUT = {
  originStationId: "origin",
  originLabel: "出発駅",
  destinationStationId: "destination",
  destinationLabel: "到着駅",
  destinationCoordinates: null,
  mode: "easy" as const,
  accessibility: { avoidStairs: false, preferElevator: false, preferEscalator: false },
};

/**
 * page.tsx が実際に行っている配線(builderを1回だけ呼び、戻り値のPromiseを
 * 複数の異なるコンポーネントへ props として共有する)を模した spy 付き StationProviderPort。
 */
function buildSpiedStationProvider(): StationProviderPort & {
  getStationSpy: ReturnType<typeof vi.fn>;
  getPlatformsSpy: ReturnType<typeof vi.fn>;
  getBoardingPositionSpy: ReturnType<typeof vi.fn>;
  getFacilitiesSpy: ReturnType<typeof vi.fn>;
} {
  const getStationSpy = vi.fn(async (stationId: string) => STATIONS[stationId] ?? null);
  const getPlatformsSpy = vi.fn(async () => [PLATFORM]);
  const getBoardingPositionSpy = vi.fn(
    async (): Promise<BoardingPosition | null> => ({
      boardingPositionId: "bp_1",
      platformId: PLATFORM.platformId,
      trainFormation: 10,
      carNumber: 5,
      doorPosition: "中央",
      targetFacilityId: "gate_1",
      reason: "テスト用の理由",
      confidence: highConfidence,
      verifiedAt: null,
    })
  );
  const getFacilitiesSpy = vi.fn(async () => FACILITIES_WITH_ELEVATOR);

  return {
    getStationSpy,
    getPlatformsSpy,
    getBoardingPositionSpy,
    getFacilitiesSpy,
    async searchStations() {
      return Object.values(STATIONS);
    },
    getStation: getStationSpy,
    getPlatforms: getPlatformsSpy,
    getFacilities: getFacilitiesSpy,
    getBoardingPosition: getBoardingPositionSpy,
    async nearestStations() {
      return Object.values(STATIONS);
    },
  };
}

describe("page.tsx の Promise as Props 配線(複数の実コンポーネントへの共有)", () => {
  test("trainSegmentsPromiseを4つの異なるコンポーネントへ渡しても、駅・号車情報の取得は1回分しか行われない", async () => {
    const stationProvider = buildSpiedStationProvider();

    // page.tsx と同じく、builder は1回だけ呼び出し、戻り値のPromiseを共有する。
    const trainSegmentsPromise = buildTrainSegments(CHOSEN, { stationProvider });
    const facilitiesPromise = buildTransferAndExitSegments(CANDIDATE, SEARCH_INPUT, {
      stationProvider,
    });

    await Promise.all([
      RouteOverviewContent({
        trainSegmentsPromise,
        facilitiesPromise,
        mode: "easy",
        transferCount: 0,
      }),
      RouteTimelineDiagramSection({
        trainSegmentsPromise,
        facilitiesPromise,
        destinationName: "到着駅",
      }),
      RouteDiagramSection({ trainSegmentsPromise, facilitiesPromise }),
      ConfidenceSummarySection({ trainSegmentsPromise, facilitiesPromise, mode: "easy" }),
    ]);

    // segments は1区間 → getStation は from/to の2回、getPlatforms/getBoardingPositionは1回。
    // 複数のコンポーネントが同じ Promise を共有しても、この回数から増えないこと。
    expect(stationProvider.getStationSpy).toHaveBeenCalledTimes(2);
    expect(stationProvider.getPlatformsSpy).toHaveBeenCalledTimes(1);
    expect(stationProvider.getBoardingPositionSpy).toHaveBeenCalledTimes(1);
  });

  test("facilitiesPromiseを5つの異なるコンポーネントへ渡しても、改札・出口情報の取得は1回しか行われない", async () => {
    const stationProvider = buildSpiedStationProvider();

    const trainSegmentsPromise = buildTrainSegments(CHOSEN, { stationProvider });
    const facilitiesPromise = buildTransferAndExitSegments(CANDIDATE, SEARCH_INPUT, {
      stationProvider,
    });

    await Promise.all([
      RouteOverviewContent({
        trainSegmentsPromise,
        facilitiesPromise,
        mode: "easy",
        transferCount: 0,
      }),
      FacilitiesWarningBadges({ facilitiesPromise }),
      RouteTimelineDiagramSection({
        trainSegmentsPromise,
        facilitiesPromise,
        destinationName: "到着駅",
      }),
      RouteDiagramSection({ trainSegmentsPromise, facilitiesPromise }),
      ConfidenceSummarySection({ trainSegmentsPromise, facilitiesPromise, mode: "easy" }),
    ]);

    expect(stationProvider.getFacilitiesSpy).toHaveBeenCalledTimes(1);
  });
});
