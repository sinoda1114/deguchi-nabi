import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Station } from "@/lib/domain/station";
import type { RailRouteCandidate } from "../RouteProviderPort";

const generateRailRoute = vi.fn();
vi.mock("../ai-route-generation", () => ({
  generateRailRoute: (...args: unknown[]) => generateRailRoute(...args),
}));

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

const GENERATED_ROUTE: RailRouteCandidate = {
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
      direction: "テスト方面",
      platformId: "",
      estimatedMinutes: 15,
    },
  ],
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
    generateRailRoute.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("両駅が解決できれば生成して返す", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateRailRoute.mockResolvedValue(GENERATED_ROUTE);

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );

    expect(result).toEqual([GENERATED_ROUTE]);
    expect(generateRailRoute).toHaveBeenCalledWith(
      "test-key",
      ORIGIN_STATION,
      DESTINATION_STATION
    );
  });

  test("同じ区間を複数回呼んでも永続キャッシュせず毎回AIを呼ぶ(council議論2026-07-20: 検索を伴うAI生成は実行ごとに表現が揺れうるため、長期TTLキャッシュの設計をやめ、毎回アドホックに生成する方針へ変更)", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateRailRoute.mockResolvedValue(GENERATED_ROUTE);

    await adapter.findRailRoutes(ORIGIN_STATION.stationId, DESTINATION_STATION.stationId);
    await adapter.findRailRoutes(ORIGIN_STATION.stationId, DESTINATION_STATION.stationId);

    expect(generateRailRoute).toHaveBeenCalledTimes(2);
  });

  test("駅のどちらかが解決できない場合は空配列を返し、AI生成は呼ばない", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      // destination は未解決(null)
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );

    expect(result).toEqual([]);
    expect(generateRailRoute).not.toHaveBeenCalled();
  });

  test("AI生成が失敗(null)した場合は空配列を返す", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateRailRoute.mockResolvedValue(null);

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );

    expect(result).toEqual([]);
  });
});
