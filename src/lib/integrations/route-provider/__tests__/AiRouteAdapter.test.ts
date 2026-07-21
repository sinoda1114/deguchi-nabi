import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Station } from "@/lib/domain/station";
import type { SingleCallNavigatorGuide } from "@/lib/integrations/ai/single-call-navigator";

const generateSingleCallNavigatorGuide = vi.fn();
vi.mock("@/lib/integrations/ai/single-call-navigator", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/integrations/ai/single-call-navigator")
  >("@/lib/integrations/ai/single-call-navigator");
  return {
    ...actual,
    generateSingleCallNavigatorGuide: (...args: unknown[]) =>
      generateSingleCallNavigatorGuide(...args),
  };
});

const { AiRouteAdapter } = await import("../AiRouteAdapter");

const ORIGIN_STATION: Station = {
  stationId: "st_unknown_origin",
  stationName: "未知駅A",
  operator: "テスト鉄道",
  lines: ["テスト線"],
  prefecture: "テスト県",
  latitude: 35.1,
  longitude: 136.2,
};

const DESTINATION_STATION: Station = {
  stationId: "st_unknown_dest",
  stationName: "未知駅B",
  operator: "テスト鉄道",
  lines: ["テスト線"],
  prefecture: "テスト県",
  latitude: 35.2,
  longitude: 136.3,
};

const GENERATED_GUIDE: SingleCallNavigatorGuide = {
  lines: ["テスト線"],
  transferCount: 0,
  estimatedMinutes: 15,
  arrivalPlatformNumber: null,
  boarding: null,
  gate: null,
  exit: null,
};

function fakeStationProvider(stations: Record<string, Station | null>) {
  return {
    searchStations: vi.fn(),
    getStation: vi.fn(async (stationId: string) => stations[stationId] ?? null),
    getPlatforms: vi.fn(),
    nearestStations: vi.fn(),
    getFacilities: vi.fn(),
    getBoardingPosition: vi.fn(),
    getArrivalGuideNarrativeSteps: vi.fn(),
  };
}

describe("AiRouteAdapter.findRailRoutes", () => {
  beforeEach(() => {
    generateSingleCallNavigatorGuide.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("両駅が解決できれば単一呼び出しの生成結果からRailRouteCandidateを組み立てて返す", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateSingleCallNavigatorGuide.mockResolvedValue(GENERATED_GUIDE);

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId,
      "組み立てテストA"
    );

    expect(result).toEqual([
      {
        originStationId: ORIGIN_STATION.stationId,
        arrivalStationId: DESTINATION_STATION.stationId,
        transferCount: 0,
        estimatedDurationMinutes: 15,
        isAiGenerated: true,
        segments: [
          {
            fromStationId: ORIGIN_STATION.stationId,
            toStationId: DESTINATION_STATION.stationId,
            line: "テスト線",
            direction: DESTINATION_STATION.stationName,
            platformId: "",
            estimatedMinutes: 15,
          },
        ],
      },
    ]);
    expect(generateSingleCallNavigatorGuide).toHaveBeenCalledWith(
      "test-key",
      ORIGIN_STATION,
      DESTINATION_STATION,
      "組み立てテストA",
      null
    );
  });

  test("駅のどちらかが解決できない場合は空配列を返し、生成は呼ばない", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      // destination は未解決(null)
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId,
      "組み立てテストB"
    );

    expect(result).toEqual([]);
    expect(generateSingleCallNavigatorGuide).not.toHaveBeenCalled();
  });

  test("生成が失敗(null)した場合は空配列を返す", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateSingleCallNavigatorGuide.mockResolvedValue(null);

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId,
      "組み立てテストC"
    );

    expect(result).toEqual([]);
  });

  test("到着番線が確認できた場合、segmentのplatformIdへ引き渡す", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateSingleCallNavigatorGuide.mockResolvedValue({
      ...GENERATED_GUIDE,
      arrivalPlatformNumber: "3",
    });

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId,
      "組み立てテストD"
    );

    expect(result[0].segments[0].platformId).toBe("3");
  });
});
