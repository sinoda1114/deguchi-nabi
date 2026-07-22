import { afterEach, describe, expect, test, vi } from "vitest";

const kvGet = vi.fn();
const kvSet = vi.fn();

vi.mock("@/lib/store/kv-cache-store", () => ({
  getKvCacheStore: () => ({ get: kvGet, set: kvSet }),
}));

const { getCachedRouteResult, setCachedRouteResult, buildReloadCacheKey } = await import(
  "../route-result-cache"
);

const SAMPLE_BUNDLE = {
  candidate: {
    ok: true as const,
    routeId: "route_origin_destination_easy",
    mode: "easy" as const,
    originName: "出発駅",
    destinationName: "到着駅",
    arrivalStationName: "到着駅",
    arrivalStationCoordinates: null,
    estimatedDurationMinutes: 10,
    transferCount: 0,
    routeWarnings: [],
    chosen: {
      originStationId: "origin",
      arrivalStationId: "destination",
      transferCount: 0,
      estimatedDurationMinutes: 10,
      isAiGenerated: true,
      segments: [],
    },
  },
  facilitiesResult: {
    transferSegment: {
      type: "transfer" as const,
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: null,
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "",
      confidence: { level: "high" as const, reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 1 },
      sourceReferences: [],
      warnings: [],
    },
    exitSegment: {
      type: "exit" as const,
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: null,
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "",
      confidence: { level: "high" as const, reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 1 },
      sourceReferences: [],
      warnings: [],
    },
    recommendedExit: "東口",
    facilityRecommendation: { state: "unavailable" as const, reason: "test" },
    elevator: null,
    hasApproximateGuidance: false,
    hasAlternativesGuidance: false,
    approximateDirectionLabel: null,
    unifiedBoardingPosition: null,
    arrivalGuide: {
      steps: [],
      destinationDirection: null,
      facility: { state: "unavailable" as const, reason: "test" },
    },
  },
  trainSegments: [],
};

describe("buildReloadCacheKey", () => {
  test("routeIdとIPを組み合わせたキーを作る(異なるIPなら別キーになる、他ユーザーとの共有を避けるため)", () => {
    const keyA = buildReloadCacheKey("route_origin_destination_easy", "203.0.113.1");
    const keyB = buildReloadCacheKey("route_origin_destination_easy", "203.0.113.2");
    expect(keyA).not.toBe(keyB);
  });

  test("同じrouteId・同じIPなら同じキーになる", () => {
    const keyA = buildReloadCacheKey("route_origin_destination_easy", "203.0.113.1");
    const keyB = buildReloadCacheKey("route_origin_destination_easy", "203.0.113.1");
    expect(keyA).toBe(keyB);
  });
});

describe("route-result-cache", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const KEY = buildReloadCacheKey("route_a", "203.0.113.1");

  test("キャッシュが無い場合はnullを返す", async () => {
    kvGet.mockResolvedValue(null);
    const result = await getCachedRouteResult(KEY);
    expect(result).toBeNull();
  });

  test("有効期限内のキャッシュがあればそのまま返す", async () => {
    kvGet.mockResolvedValue({
      value: SAMPLE_BUNDLE,
      verifiedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await getCachedRouteResult(KEY);
    expect(result).toEqual(SAMPLE_BUNDLE);
  });

  test("有効期限切れのキャッシュはnull扱いにする(KvCacheStore自体はexpiresAtを見ないため呼び出し側で判定)", async () => {
    kvGet.mockResolvedValue({
      value: SAMPLE_BUNDLE,
      verifiedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = await getCachedRouteResult(KEY);
    expect(result).toBeNull();
  });

  test("expiresAtがnull(無期限)の場合はfail-closedでnull扱いにする(/ai-review指摘、Codex: このキャッシュの安全境界は短時間だけであるべき)", async () => {
    kvGet.mockResolvedValue({
      value: SAMPLE_BUNDLE,
      verifiedAt: new Date().toISOString(),
      expiresAt: null,
    });
    const result = await getCachedRouteResult(KEY);
    expect(result).toBeNull();
  });

  test("expiresAtが不正な日時文字列の場合もfail-closedでnull扱いにする(/ai-review指摘、Codex: NaN比較が常にfalseになり無期限有効化してしまうバグの回帰テスト)", async () => {
    kvGet.mockResolvedValue({
      value: SAMPLE_BUNDLE,
      verifiedAt: new Date().toISOString(),
      expiresAt: "not-a-valid-date",
    });
    const result = await getCachedRouteResult(KEY);
    expect(result).toBeNull();
  });

  test("setCachedRouteResultはroute-result-reload-cacheコレクションへ10分相当のttlDaysで書き込む", async () => {
    kvSet.mockResolvedValue(undefined);
    await setCachedRouteResult(KEY, SAMPLE_BUNDLE);
    expect(kvSet).toHaveBeenCalledWith(
      "route-result-reload-cache",
      KEY,
      SAMPLE_BUNDLE,
      { ttlDays: 10 / (24 * 60) }
    );
  });
});
