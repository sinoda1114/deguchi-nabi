import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoardingPosition, Station, StationFacility } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";
import type { Confidence } from "@/lib/domain/confidence";

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

// リロード耐性キャッシュ(route-result-cache.ts)は既定でnull(キャッシュ無し)を
// 返すようモックする。実際のKvCacheStore(globalThisにメモ化されるシングルトン)
// を経由させると、このファイル内の複数テストが同じorigin/destination/modeを
// 使い回すため、あるテストのfire-and-forget書き込みが後続テストへ意図せず
// ヒットしてしまう(テスト間の状態漏れ)。個別のキャッシュ挙動テストは
// 別ファイル(RouteResultBody.cache.test.tsx)で行う。
vi.mock("@/lib/services/route-result-cache", () => ({
  getCachedRouteResult: (...args: unknown[]) => getCachedRouteResultMock(...args),
  setCachedRouteResult: (...args: unknown[]) => setCachedRouteResultMock(...args),
  buildReloadCacheKey: (routeId: string, clientIp: string) => `${routeId}::ip:${clientIp}`,
}));

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

describe("RouteResultBody", () => {
  beforeEach(() => {
    getFacilitiesMock.mockReset();
    addHistoryEntryMock.mockReset();
    findRailRoutesMock.mockReset();
    findRailRoutesMock.mockResolvedValue([DEFAULT_RAIL_ROUTE]);
    getCachedRouteResultMock.mockReset();
    getCachedRouteResultMock.mockResolvedValue(null);
    setCachedRouteResultMock.mockReset();
    setCachedRouteResultMock.mockResolvedValue(undefined);
  });

  test("accessibleモードでエレベーター情報が確認できない場合、通常表示にならずエラー画面を返し、履歴も保存しない", async () => {
    getFacilitiesMock.mockResolvedValue([]); // エレベーターなし
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    const element = await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "accessible",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });
    const html = renderToStaticMarkup(element);

    // エラー画面固有の文言(検索へ戻る導線)が出ており、
    // 「ルートを保存」「この案内について質問する」等の通常導線は出ていないこと。
    expect(html).toContain("検索へ戻る");
    expect(html).not.toContain("この案内について質問する");
    expect(html).not.toContain("ルートを保存");
    expect(addHistoryEntryMock).not.toHaveBeenCalled();
  });

  test("accessibleモードでエレベーター情報が確認できる場合、通常表示になり履歴も保存する", async () => {
    getFacilitiesMock.mockResolvedValue(FACILITIES_WITH_ELEVATOR);
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    const element = await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "accessible",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("この案内について質問する");
    expect(addHistoryEntryMock).toHaveBeenCalledTimes(1);
  });

  test("easy/fastestモードではfacilities解決を待たずに履歴を保存する(既存のストリーミング挙動を維持)", async () => {
    // getFacilities は resolve が遅くても、履歴保存自体はそれを待たずに行われる
    // (easy/fastest モードでは facilities が ok:false になることは無いため)。
    let resolveFacilities: (value: StationFacility[]) => void = () => {};
    getFacilitiesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFacilities = resolve;
        })
    );
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "easy",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });

    expect(addHistoryEntryMock).toHaveBeenCalledTimes(1);
    resolveFacilities(FACILITIES_WITH_ELEVATOR); // pending promiseを片付ける
  });

  test("正常系では出発駅・到着駅を入れ替えた「帰りのルートを見る」リンクを表示する", async () => {
    getFacilitiesMock.mockResolvedValue(FACILITIES_WITH_ELEVATOR);
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    const element = await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "easy",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("帰りのルートを見る");
    expect(html).toContain(
      "/routes/result?originType=station&amp;originStationId=destination&amp;destinationType=station&amp;destinationId=origin&amp;mode=easy"
    );
  });

  test("再試行可能なエラー(バリアフリー経路の設備情報を確認できない場合)では「もう一度検索」ボタンも表示する", async () => {
    getFacilitiesMock.mockResolvedValue([]); // エレベーターなし(accessibleでエラーになる)
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    const element = await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "accessible",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("もう一度検索");
    expect(html).toContain("検索へ戻る");
  });

  test("再試行可能なエラー(AI生成失敗の可能性がある経路探索自体の失敗)では「もう一度検索」ボタンも表示する", async () => {
    findRailRoutesMock.mockResolvedValue([]); // この区間の鉄道経路情報が無い(resolveRouteCandidateがok:falseを返す)
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    const element = await RouteResultBody({
      origin: ORIGIN,
      destination: DESTINATION,
      mode: "easy",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("もう一度検索");
    expect(html).toContain("検索へ戻る");
    expect(addHistoryEntryMock).not.toHaveBeenCalled();
  });

  test("再試行不可能なエラー(駅・施設IDが解決できない)では「もう一度検索」ボタンを表示しない", async () => {
    const { RouteResultBody } = await import("@/components/result/RouteResultBody");

    const element = await RouteResultBody({
      origin: ORIGIN,
      destination: { type: "station", stationId: "not_found_station" },
      mode: "easy",
      user: BASE_USER,
      clientIp: "203.0.113.1",
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("検索へ戻る");
    expect(html).not.toContain("もう一度検索");
  });
});
