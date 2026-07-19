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
interface RouteKvRow {
  value: unknown;
  expiresAt: string | null;
}

const kvState = new Map<string, Map<string, RouteKvRow>>();

function collectionMap(collection: string): Map<string, RouteKvRow> {
  let m = kvState.get(collection);
  if (!m) {
    m = new Map();
    kvState.set(collection, m);
  }
  return m;
}

/** SWRテスト用: 既存エントリのexpiresAtを過去日時に書き換え、期限切れ状態を作る。 */
function forceExpireKvEntry(collection: string, key: string): void {
  const row = kvState.get(collection)?.get(key);
  if (row) row.expiresAt = new Date(Date.now() - 1000).toISOString();
}

const kvStoreMock = {
  get: vi.fn(async (collection: string, key: string) => {
    const row = kvState.get(collection)?.get(key);
    if (!row) return null;
    return { value: row.value, verifiedAt: new Date(0).toISOString(), expiresAt: row.expiresAt };
  }),
  set: vi.fn(async (collection: string, key: string, value: unknown, opts?: { ttlDays: number | null }) => {
    const ttlDays = opts?.ttlDays ?? null;
    const expiresAt =
      ttlDays === null ? null : new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    collectionMap(collection).set(key, { value, expiresAt });
  }),
  deleteByKeyPrefix: vi.fn(async () => 0),
  countByKeyPrefix: vi.fn(async () => 0),
  deleteOldestByKeyPrefix: vi.fn(async () => undefined),
};

vi.mock("@/lib/store/kv-cache-store", () => ({
  getKvCacheStore: () => kvStoreMock,
}));

/**
 * scheduleStaleRefresh(swr-refresh.ts)が使うnext/serverのafter()をモックする。
 * 実行をキューに貯め、テストコードからflushAfterCallbacks()で明示的に
 * 完了を待てるようにする。
 */
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", () => ({
  after: (cb: () => Promise<void>) => {
    afterCallbacks.push(cb);
  },
}));

async function flushAfterCallbacks(): Promise<void> {
  const callbacks = afterCallbacks.splice(0, afterCallbacks.length);
  await Promise.all(callbacks.map((cb) => cb()));
}

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

describe("CompositeRouteAdapter stale-while-revalidate(PR3)", () => {
  beforeEach(() => {
    kvState.clear();
    afterCallbacks.length = 0;
    generateRailRoute.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
  });

  test("有効期限内のキャッシュヒットでは裏再生成をスケジュールしない", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new CompositeRouteAdapter("test-key", stationProvider);
    generateRailRoute.mockResolvedValueOnce(GENERATED_ROUTE);

    await adapter.findRailRoutes(ORIGIN_STATION.stationId, DESTINATION_STATION.stationId); // 初回生成(TTL180日、期限内)

    generateRailRoute.mockReset().mockResolvedValue(GENERATED_ROUTE);
    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );
    await flushAfterCallbacks();

    expect(result).toEqual([GENERATED_ROUTE]);
    expect(generateRailRoute).not.toHaveBeenCalled();
  });

  test("期限切れキャッシュは古い値を即返しつつ、裏で再生成して上書きする", async () => {
    const OLD_ROUTE = { ...GENERATED_ROUTE, estimatedDurationMinutes: 15 };
    const NEW_ROUTE = { ...GENERATED_ROUTE, estimatedDurationMinutes: 20 };
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new CompositeRouteAdapter("test-key", stationProvider);
    generateRailRoute.mockResolvedValueOnce(OLD_ROUTE);

    await adapter.findRailRoutes(ORIGIN_STATION.stationId, DESTINATION_STATION.stationId);
    forceExpireKvEntry(
      "ai-rail-routes",
      `${ORIGIN_STATION.stationId}__${DESTINATION_STATION.stationId}`
    );

    generateRailRoute.mockReset().mockResolvedValue(NEW_ROUTE);
    const staleResult = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );

    expect(staleResult).toEqual([OLD_ROUTE]);
    expect(generateRailRoute).not.toHaveBeenCalled();

    await flushAfterCallbacks();

    expect(generateRailRoute).toHaveBeenCalledTimes(1);
    const refreshedResult = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId
    );
    expect(refreshedResult).toEqual([NEW_ROUTE]);
  });

  test("裏再生成で駅が解決できなくなっていた場合は上書きしない", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new CompositeRouteAdapter("test-key", stationProvider);
    generateRailRoute.mockResolvedValueOnce(GENERATED_ROUTE);

    await adapter.findRailRoutes(ORIGIN_STATION.stationId, DESTINATION_STATION.stationId);
    forceExpireKvEntry(
      "ai-rail-routes",
      `${ORIGIN_STATION.stationId}__${DESTINATION_STATION.stationId}`
    );
    stationProvider.getStation.mockResolvedValue(null);

    await adapter.findRailRoutes(ORIGIN_STATION.stationId, DESTINATION_STATION.stationId);
    await flushAfterCallbacks();

    expect(kvStoreMock.set).toHaveBeenCalledTimes(1); // 初回のみ、裏再生成では上書きされない
  });
});
