import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardingPosition, Station, StationFacility } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";
import type { Confidence } from "@/lib/domain/confidence";

/**
 * RouteResultBody.tsxのリロード耐性キャッシュ(route-result-cache.ts)配線を
 * 検証する。RouteResultBody.test.tsxは既存の生成挙動(常にキャッシュ無し前提)を
 * 検証するファイルのため、キャッシュヒット時の挙動はここで別途検証する
 * (テスト間の関心の分離)。
 */

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

const BASE_USER: User = {
  userId: "user_1",
  email: "user@example.com",
  displayName: "テストユーザー",
  homeStationId: "origin",
  plan: "free",
  locale: "ja",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const getFacilitiesMock = vi.fn<(stationId: string) => Promise<StationFacility[]>>();
const addHistoryEntryMock = vi.fn();
const findRailRoutesMock = vi.fn();
const getCachedRouteResultMock = vi.fn();
const setCachedRouteResultMock = vi.fn();

const DEFAULT_RAIL_ROUTE = {
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
      platformId: "platform_1",
      estimatedMinutes: 10,
    },
  ],
};

vi.mock("@/lib/store/history-repository", () => ({
  addHistoryEntry: (...args: unknown[]) => addHistoryEntryMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/services/route-result-cache", () => ({
  getCachedRouteResult: (...args: unknown[]) => getCachedRouteResultMock(...args),
  setCachedRouteResult: (...args: unknown[]) => setCachedRouteResultMock(...args),
  buildReloadCacheKey: (routeId: string, clientIp: string) => `${routeId}::ip:${clientIp}`,
}));

vi.mock("@/lib/integrations", () => ({
  stationProvider: {
    async searchStations() {
      return Object.values(STATIONS);
    },
    async getStation(stationId: string) {
      return STATIONS[stationId] ?? null;
    },
    async getPlatforms() {
      return [];
    },
    async getFacilities(stationId: string) {
      return getFacilitiesMock(stationId);
    },
    async getBoardingPosition(): Promise<BoardingPosition | null> {
      return null;
    },
    async nearestStations() {
      return Object.values(STATIONS);
    },
  },
  routeProvider: {
    async findRailRoutes() {
      return findRailRoutesMock();
    },
  },
  placeProvider: {
    async searchPlaces() {
      return [];
    },
    async getPlace() {
      return null;
    },
  },
}));

const ORIGIN = { type: "station" as const, stationId: "origin" };
const DESTINATION = { type: "station" as const, stationId: "destination" };

const CACHED_BUNDLE = {
  candidate: {
    ok: true as const,
    routeId: "route_origin_destination_easy",
    mode: "easy" as const,
    originName: "出発駅",
    destinationName: "到着駅",
    arrivalStationName: "到着駅",
    arrivalStationCoordinates: null,
    // 42という値自体に意味は無く、freshly generated(DEFAULT_RAIL_ROUTEの10分)とは
    // 異なる値にすることで、「candidateがキャッシュ由来である」ことをRouteOverviewCard
    // (Suspenseの外、同期描画される部分)から検証できるようにするための目印。
    estimatedDurationMinutes: 42,
    transferCount: 0,
    routeWarnings: [],
    chosen: DEFAULT_RAIL_ROUTE,
  },
  facilitiesResult: {
    transferSegment: {
      type: "transfer" as const,
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: "キャッシュ改札方面",
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "キャッシュ改札へ向かってください。",
      confidence: highConfidence,
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
      instruction: "キャッシュ出口から出てください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    recommendedExit: "キャッシュ出口",
    facilityRecommendation: {
      state: "confirmed" as const,
      pair: {
        gate: { name: "キャッシュ改札", confidence: highConfidence },
        exit: { name: "キャッシュ出口", confidence: highConfidence },
        reason: null,
      },
    },
    elevator: null,
    hasApproximateGuidance: false,
    hasAlternativesGuidance: false,
    approximateDirectionLabel: null,
    unifiedBoardingPosition: null,
    arrivalGuide: {
      steps: [
        {
          type: "ticket_gate" as const,
          title: "キャッシュ改札",
          instruction: "キャッシュ改札を利用してください。",
          landmarks: [],
          confidence: highConfidence,
          provenance: "surveyed" as const,
        },
      ],
      destinationDirection: null,
      facility: {
        state: "confirmed" as const,
        pair: {
          gate: { name: "キャッシュ改札", confidence: highConfidence },
          exit: { name: "キャッシュ出口", confidence: highConfidence },
          reason: null,
        },
      },
    },
  },
  trainSegments: [
    {
      type: "train" as const,
      from: "出発駅",
      to: "到着駅",
      line: "テスト線",
      direction: "到着駅方面",
      platform: "1",
      boardingPosition: null,
      facilities: [],
      instruction: "テスト線に乗車してください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
  ],
};

describe("RouteResultBody のリロード耐性キャッシュ", () => {
  beforeEach(() => {
    getFacilitiesMock.mockReset();
    addHistoryEntryMock.mockReset();
    findRailRoutesMock.mockReset();
    findRailRoutesMock.mockResolvedValue([DEFAULT_RAIL_ROUTE]);
    getCachedRouteResultMock.mockReset();
    setCachedRouteResultMock.mockReset();
    setCachedRouteResultMock.mockResolvedValue(undefined);
  });

  test("キャッシュヒット時は経路探索(findRailRoutes)を呼ばず、キャッシュのcandidateをそのまま表示する", async () => {
    getCachedRouteResultMock.mockResolvedValue(CACHED_BUNDLE);
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    const element = await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "easy",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });
    // renderToStaticMarkupはネストされた非同期Suspense子(RouteGateStat等)を
    // 解決しないため、Suspenseの外で同期描画されるRouteOverviewCardの内容
    // (candidate.estimatedDurationMinutes)でキャッシュ由来であることを検証する。
    const html = renderToStaticMarkup(element);

    expect(findRailRoutesMock).not.toHaveBeenCalled();
    expect(html).toContain("約42分");
  });

  test("キャッシュヒット時は履歴を重複保存しない", async () => {
    getCachedRouteResultMock.mockResolvedValue(CACHED_BUNDLE);
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "easy",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });

    expect(addHistoryEntryMock).not.toHaveBeenCalled();
  });

  test("キャッシュヒット時は新たにキャッシュへ書き込まない(再書き込みでTTLを延長しない)", async () => {
    getCachedRouteResultMock.mockResolvedValue(CACHED_BUNDLE);
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "easy",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });

    expect(setCachedRouteResultMock).not.toHaveBeenCalled();
  });

  test("キャッシュミス時は通常通り経路探索を行い、成功後にキャッシュへ書き込む", async () => {
    getCachedRouteResultMock.mockResolvedValue(null);
    getFacilitiesMock.mockResolvedValue([]);
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "easy",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });

    expect(findRailRoutesMock).toHaveBeenCalledTimes(1);
    // 書き込みはfire-and-forget(await されない)のため、マイクロタスクの解決を待つ。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setCachedRouteResultMock).toHaveBeenCalledTimes(1);
    const [cacheKeyArg] = setCachedRouteResultMock.mock.calls[0];
    // clientIpでスコープされたキー(route-result-cache.tsのbuildReloadCacheKey)。
    // routeId単体だとユーザー間でキャッシュが共有されてしまうため(/ai-review指摘)。
    expect(cacheKeyArg).toBe("route_origin_destination_easy::ip:203.0.113.1");
  });
});
