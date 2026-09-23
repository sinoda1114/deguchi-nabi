import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Station } from "@/lib/domain/station";
import type { SingleCallNavigatorGuide } from "@/lib/integrations/ai/single-call-navigator";
import { UECHABE_DOGENZAKA } from "@/lib/eval/exit-quality-gate";

const generateSingleCallNavigatorGuide = vi.fn();
const generateSingleCallNavigatorRun = vi.fn();
vi.mock("@/lib/integrations/ai/single-call-navigator", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/integrations/ai/single-call-navigator")
  >("@/lib/integrations/ai/single-call-navigator");
  return {
    ...actual,
    generateSingleCallNavigatorGuide: (...args: unknown[]) =>
      generateSingleCallNavigatorGuide(...args),
    generateSingleCallNavigatorRun: (...args: unknown[]) =>
      generateSingleCallNavigatorRun(...args),
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
  facility: { state: "unavailable", reason: "test" },
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
    generateSingleCallNavigatorRun.mockReturnValue({
      first: Promise.resolve(GENERATED_GUIDE),
      final: Promise.resolve(GENERATED_GUIDE),
    });

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
    expect(generateSingleCallNavigatorRun).toHaveBeenCalledWith(
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
    expect(generateSingleCallNavigatorRun).not.toHaveBeenCalled();
  });

  test("出発駅と到着駅が同一の場合は train segment を返さず guide は共有 run から組み立てる", async () => {
    const sakae: Station = {
      stationId: "hr_sakae",
      stationName: "栄駅",
      operator: "",
      lines: ["名古屋市営地下鉄東山線"],
      prefecture: "愛知県",
      latitude: 35.17,
      longitude: 136.908,
    };
    const stationProvider = fakeStationProvider({
      [sakae.stationId]: sakae,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateSingleCallNavigatorRun.mockReturnValue({
      first: Promise.resolve({
        ...GENERATED_GUIDE,
        lines: ["同一駅（乗車不要）"],
        transferCount: 0,
        estimatedMinutes: 5,
      }),
      final: Promise.resolve({
        ...GENERATED_GUIDE,
        lines: ["同一駅（乗車不要）"],
        transferCount: 0,
        estimatedMinutes: 5,
      }),
    });

    const result = await adapter.findRailRoutes(
      sakae.stationId,
      sakae.stationId,
      "焼肉ワガママ気まま"
    );

    expect(result).toHaveLength(1);
    expect(result[0].segments).toEqual([]);
    expect(result[0].transferCount).toBe(0);
    expect(result[0].estimatedDurationMinutes).toBe(5);
  });

  test("HeartRails ID が異なるが同一構内（なんば/難波）なら train segment を省略する", async () => {
    const nambaHira: Station = {
      stationId: "hr_%E3%81%AA%E3%82%93%E3%81%B0_135.5003_34.6663",
      stationName: "なんば駅",
      operator: "",
      lines: [],
      prefecture: "大阪府",
      latitude: 34.6663,
      longitude: 135.5003,
    };
    const nambaKanji: Station = {
      stationId: "hr_%E9%9B%A2%E6%B3%A2_135.5019_34.6636",
      stationName: "難波駅",
      operator: "",
      lines: [],
      prefecture: "大阪府",
      latitude: 34.6636,
      longitude: 135.5019,
    };
    const stationProvider = fakeStationProvider({
      [nambaHira.stationId]: nambaHira,
      [nambaKanji.stationId]: nambaKanji,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateSingleCallNavigatorRun.mockReturnValue({
      first: Promise.resolve({ ...GENERATED_GUIDE, transferCount: 0, estimatedMinutes: 4 }),
      final: Promise.resolve({ ...GENERATED_GUIDE, transferCount: 0, estimatedMinutes: 4 }),
    });

    const result = await adapter.findRailRoutes(
      nambaHira.stationId,
      nambaKanji.stationId,
      "仙太郎 髙島屋大阪店"
    );

    expect(result).toHaveLength(1);
    expect(result[0].segments).toEqual([]);
    expect(result[0].transferCount).toBe(0);
  });

  test("生成が失敗(null)した場合は空配列を返す", async () => {
    const stationProvider = fakeStationProvider({
      [ORIGIN_STATION.stationId]: ORIGIN_STATION,
      [DESTINATION_STATION.stationId]: DESTINATION_STATION,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateSingleCallNavigatorRun.mockReturnValue({
      first: Promise.resolve(null),
      final: Promise.resolve(null),
    });

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
    generateSingleCallNavigatorRun.mockReturnValue({
      first: Promise.resolve({
        ...GENERATED_GUIDE,
        arrivalPlatformNumber: "3",
      }),
      final: Promise.resolve({
        ...GENERATED_GUIDE,
        arrivalPlatformNumber: "3",
      }),
    });

    const result = await adapter.findRailRoutes(
      ORIGIN_STATION.stationId,
      DESTINATION_STATION.stationId,
      "組み立てテストD"
    );

    expect(result[0].segments[0].platformId).toBe("3");
  });

  test("渋谷+ウエチャベ座標でも共有 run は座標を渡すだけ(改札解決は navigator 内)", async () => {
    const shibuya: Station = {
      stationId: "hr_shibuya",
      stationName: "渋谷駅",
      operator: "東急電鉄",
      lines: ["東急東横線"],
      prefecture: "東京都",
      latitude: 35.65861,
      longitude: 139.70111,
    };
    const nishiya: Station = {
      stationId: "st_nishiya",
      stationName: "西谷駅",
      operator: "相模鉄道",
      lines: ["相鉄本線"],
      prefecture: "神奈川県",
      latitude: 35.4696,
      longitude: 139.5679,
    };
    const stationProvider = fakeStationProvider({
      [nishiya.stationId]: nishiya,
      [shibuya.stationId]: shibuya,
    });
    const adapter = new AiRouteAdapter("test-key", stationProvider);
    generateSingleCallNavigatorRun.mockReturnValue({
      first: Promise.resolve(GENERATED_GUIDE),
      final: Promise.resolve(GENERATED_GUIDE),
    });

    await adapter.findRailRoutes(
      nishiya.stationId,
      shibuya.stationId,
      UECHABE_DOGENZAKA.label,
      UECHABE_DOGENZAKA.coordinates
    );

    expect(generateSingleCallNavigatorRun).toHaveBeenCalledWith(
      "test-key",
      nishiya,
      shibuya,
      UECHABE_DOGENZAKA.label,
      UECHABE_DOGENZAKA.coordinates
    );
  });
});
