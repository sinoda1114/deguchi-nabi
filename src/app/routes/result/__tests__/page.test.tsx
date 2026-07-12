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
const getSessionUserMock = vi.fn<() => Promise<User | null>>();

vi.mock("@/lib/store/history-repository", () => ({
  addHistoryEntry: (...args: unknown[]) => addHistoryEntryMock(...args),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
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
              platformId: "platform_1",
              estimatedMinutes: 10,
            },
          ],
        },
      ];
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

const SEARCH_PARAMS = {
  originType: "station",
  originStationId: "origin",
  destinationType: "station",
  destinationId: "destination",
};

describe("RouteResultPage", () => {
  beforeEach(() => {
    getFacilitiesMock.mockReset();
    addHistoryEntryMock.mockReset();
    getSessionUserMock.mockReset();
    getSessionUserMock.mockResolvedValue(BASE_USER);
  });

  test("accessibleモードでエレベーター情報が確認できない場合、通常表示にならずエラー画面を返し、履歴も保存しない", async () => {
    getFacilitiesMock.mockResolvedValue([]); // エレベーターなし
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    const element = await RouteResultPage({
      searchParams: Promise.resolve({ ...SEARCH_PARAMS, mode: "accessible" }),
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
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    const element = await RouteResultPage({
      searchParams: Promise.resolve({ ...SEARCH_PARAMS, mode: "accessible" }),
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
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    await RouteResultPage({
      searchParams: Promise.resolve({ ...SEARCH_PARAMS, mode: "easy" }),
    });

    expect(addHistoryEntryMock).toHaveBeenCalledTimes(1);
    resolveFacilities(FACILITIES_WITH_ELEVATOR); // pending promiseを片付ける
  });

  test("正常系では出発駅・到着駅を入れ替えた「帰りのルートを見る」リンクを表示する", async () => {
    getFacilitiesMock.mockResolvedValue(FACILITIES_WITH_ELEVATOR);
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    const element = await RouteResultPage({
      searchParams: Promise.resolve({ ...SEARCH_PARAMS, mode: "easy" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("帰りのルートを見る");
    expect(html).toContain(
      "/routes/result?originType=station&amp;originStationId=destination&amp;destinationType=station&amp;destinationId=origin&amp;mode=easy"
    );
  });

  test("再試行可能なエラー(AI生成失敗の可能性がある経路探索失敗)では「もう一度検索」ボタンも表示する", async () => {
    getFacilitiesMock.mockResolvedValue([]); // エレベーターなし(accessibleでエラーになる)
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    const element = await RouteResultPage({
      searchParams: Promise.resolve({ ...SEARCH_PARAMS, mode: "accessible" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("もう一度検索");
    expect(html).toContain("検索へ戻る");
  });

  test("再試行不可能なエラー(検索条件不足)では「もう一度検索」ボタンを表示しない", async () => {
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    const element = await RouteResultPage({
      searchParams: Promise.resolve({ mode: "easy" }), // originStationId/destinationId無し
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("検索条件が不足しています");
    expect(html).toContain("検索へ戻る");
    expect(html).not.toContain("もう一度検索");
  });

  test("再試行不可能なエラー(駅・施設IDが解決できない)では「もう一度検索」ボタンを表示しない", async () => {
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    const element = await RouteResultPage({
      searchParams: Promise.resolve({
        ...SEARCH_PARAMS,
        destinationId: "not_found_station",
        mode: "easy",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("検索へ戻る");
    expect(html).not.toContain("もう一度検索");
  });
});
