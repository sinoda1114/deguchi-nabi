import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Station } from "@/lib/domain/station";
import type { RailRouteCandidate } from "../RouteProviderPort";

/**
 * KvCacheStore(@/lib/store/kv-cache-store の getKvCacheStore)のインメモリ・
 * フェイク。CompositeStationAdapter.test.ts と同じ発想(collection -> key の
 * 入れ子Map)だが、CompositeRouteAdapter は get/set しか使わないため、
 * countByKeyPrefix/deleteOldestByKeyPrefix/deleteByKeyPrefix は
 * インターフェース充足のためのダミー実装のみ持たせる。
 */
const kvState = new Map<string, Map<string, unknown>>();

function collectionMap(collection: string): Map<string, unknown> {
  let m = kvState.get(collection);
  if (!m) {
    m = new Map();
    kvState.set(collection, m);
  }
  return m;
}

const kvStoreMock = {
  get: vi.fn(async (collection: string, key: string) => {
    const value = kvState.get(collection)?.get(key);
    if (value === undefined) return null;
    return { value, verifiedAt: new Date(0).toISOString(), expiresAt: null };
  }),
  set: vi.fn(async (collection: string, key: string, value: unknown) => {
    collectionMap(collection).set(key, value);
  }),
  deleteByKeyPrefix: vi.fn(async () => 0),
  countByKeyPrefix: vi.fn(async () => 0),
  deleteOldestByKeyPrefix: vi.fn(async () => undefined),
};

vi.mock("@/lib/store/kv-cache-store", () => ({
  getKvCacheStore: () => kvStoreMock,
}));

const generateRailRoute = vi.fn();
vi.mock("../ai-route-generation", () => ({
  generateRailRoute: (...args: unknown[]) => generateRailRoute(...args),
}));

const { CompositeRouteAdapter } = await import("../CompositeRouteAdapter");

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

describe("CompositeRouteAdapter.findRailRoutes", () => {
  beforeEach(() => {
    kvState.clear();
    generateRailRoute.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("fixtureに区間があればそれを返し、AI生成もキャッシュ読み書きも行わない", async () => {
    const stationProvider = fakeStationProvider({});
    const adapter = new CompositeRouteAdapter("test-key", stationProvider);

    const result = await adapter.findRailRoutes("st_nishiya", "st_shibuya");

    expect(result).toHaveLength(1);
    expect(result[0].originStationId).toBe("st_nishiya");
    expect(generateRailRoute).not.toHaveBeenCalled();
    expect(kvStoreMock.get).not.toHaveBeenCalled();
  });

  test("キャッシュにヒットすればAI生成を呼ばずキャッシュ値を返す", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new CompositeRouteAdapter("test-key", stationProvider);
    generateRailRoute.mockResolvedValue(GENERATED_ROUTE);

    await adapter.findRailRoutes(ORIGIN_STATION.stationId, DESTINATION_STATION.stationId);
    generateRailRoute.mockClear();
    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );

    expect(result).toEqual([GENERATED_ROUTE]);
    expect(generateRailRoute).not.toHaveBeenCalled();
  });

  test("両駅が解決できれば生成し、`${originStationId}__${destinationStationId}`キーでKvCacheStoreにttlDays180で保存する(キー設計の回帰確認)", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new CompositeRouteAdapter("test-key", stationProvider);
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
    expect(kvStoreMock.set).toHaveBeenCalledWith(
      "ai-rail-routes",
      `${ORIGIN_STATION.stationId}__${DESTINATION_STATION.stationId}`,
      GENERATED_ROUTE,
      { ttlDays: 180 }
    );
  });

  test("駅のどちらかが解決できない場合は空配列を返し、AI生成は呼ばない", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      // destination は未解決(null)
    });
    const adapter = new CompositeRouteAdapter("test-key", stationProvider);

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );

    expect(result).toEqual([]);
    expect(generateRailRoute).not.toHaveBeenCalled();
  });

  test("AI生成が失敗(null)した場合は空配列を返し、キャッシュに書き込まない", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new CompositeRouteAdapter("test-key", stationProvider);
    generateRailRoute.mockResolvedValue(null);

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );

    expect(result).toEqual([]);
    expect(kvStoreMock.set).not.toHaveBeenCalled();
  });
});
