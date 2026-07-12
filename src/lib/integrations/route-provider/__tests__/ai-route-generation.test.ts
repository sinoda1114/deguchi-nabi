import { afterEach, describe, expect, test, vi } from "vitest";
import { generateRailRoute } from "../ai-route-generation";
import type { Station } from "@/lib/domain/station";

const searchAndGenerateStructuredContent = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContent: (...args: unknown[]) =>
    searchAndGenerateStructuredContent(...args),
}));

const NAGOYA_KOKUSAI_CENTER: Station = {
  stationId: "hr_%E5%9B%BD%E9%9A%9B%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC_136.8894_35.1721",
  stationName: "国際センター駅",
  operator: "",
  lines: [],
  prefecture: "愛知県",
  latitude: 35.1721,
  longitude: 136.8894,
};

const NISHIYA: Station = {
  stationId: "st_nishiya",
  stationName: "西谷駅",
  operator: "相模鉄道",
  lines: ["相鉄本線", "相鉄新横浜線"],
  prefecture: "神奈川県",
  latitude: 35.4696,
  longitude: 139.5679,
};

describe("generateRailRoute", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("同名駅の曖昧性解消のため、検索プロンプトに出発地・目的地の都道府県と座標を含める", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["JR東海道新幹線"],
      transferCount: 2,
      estimatedMinutes: 120,
    });

    await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);

    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("神奈川県");
    expect(searchPrompt).toContain("愛知県");
    expect(searchPrompt).toContain("35.1721");
    expect(searchPrompt).toContain("136.8894");
    expect(searchPrompt).toContain("複数の都道府県");
  });

  test("prefectureが空(HeartRails decode fallback)でも座標だけで曖昧性解消のヒントを出す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["JR東海道新幹線"],
      transferCount: 2,
      estimatedMinutes: 120,
    });

    const noPrefecture: Station = { ...NAGOYA_KOKUSAI_CENTER, prefecture: "" };
    await generateRailRoute("key", NISHIYA, noPrefecture);

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("35.1721");
    expect(searchPrompt).toContain("136.8894");
  });

  test("生成結果のstationIdは渡されたStationのstationIdを使う", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["JR東海道新幹線"],
      transferCount: 2,
      estimatedMinutes: 120,
    });

    const result = await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);
    expect(result?.originStationId).toBe("st_nishiya");
    expect(result?.arrivalStationId).toBe(NAGOYA_KOKUSAI_CENTER.stationId);
    expect(result?.segments[0].fromStationId).toBe("st_nishiya");
    expect(result?.segments[0].toStationId).toBe(NAGOYA_KOKUSAI_CENTER.stationId);
  });
});
