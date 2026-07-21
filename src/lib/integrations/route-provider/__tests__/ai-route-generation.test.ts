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

  test("検索プロンプトに到着番線の確認を依頼する指示を含める", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["JR東海道新幹線"],
      transferCount: 2,
      estimatedMinutes: 120,
    });

    await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("到着番線");
  });

  test("検索結果に到着番線が含まれる場合、segmentのplatformIdへ引き渡す(号車推定への連携用)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["JR東海道新幹線"],
      transferCount: 2,
      estimatedMinutes: 120,
      arrivalPlatformNumber: "3",
    });

    const result = await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);
    expect(result?.segments[0].platformId).toBe("3");
  });

  test("到着番線が確認できない場合はplatformIdを空文字のままにする(無理に埋めない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["JR東海道新幹線"],
      transferCount: 2,
      estimatedMinutes: 120,
    });

    const result = await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);
    expect(result?.segments[0].platformId).toBe("");
  });

  test("到着番線が異常に長い場合や型が不正な場合は採用せず空文字のままにする", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["JR東海道新幹線"],
      transferCount: 2,
      estimatedMinutes: 120,
      arrivalPlatformNumber: "あ".repeat(30),
    });

    const result = await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);
    expect(result?.segments[0].platformId).toBe("");
  });

  test("路線名に縮退生成の反復パターンが含まれる場合は無効として扱い、最終的にnullを返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["瘉鉄改戳版最改版甘鉄改戳版最改版・瘉鉄改戳版最改版甘鉄改戳版最改版"],
      transferCount: 2,
      estimatedMinutes: 120,
    });

    const result = await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);
    expect(result).toBeNull();
  });

  test("1回目が反復パターンで無効・2回目が正常な結果の場合、2回目の結果を返す(リトライが機能する)", async () => {
    searchAndGenerateStructuredContent
      .mockResolvedValueOnce({
        lines: ["瘉鉄改戳版最改版甘鉄改戳版最改版・瘉鉄改戳版最改版甘鉄改戳版最改版"],
        transferCount: 2,
        estimatedMinutes: 120,
      })
      .mockResolvedValueOnce({
        lines: ["JR東海道新幹線"],
        transferCount: 2,
        estimatedMinutes: 120,
      });

    const result = await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);
    expect(result?.segments[0].line).toBe("JR東海道新幹線");
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(2);
  });

  test("2回とも反復パターンで無効な場合、最終的にnullを返し3回目は試行しない", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["瘉鉄改戳版最改版甘鉄改戳版最改版・瘉鉄改戳版最改版甘鉄改戳版最改版"],
      transferCount: 2,
      estimatedMinutes: 120,
    });

    const result = await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);
    expect(result).toBeNull();
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(2);
  });

  test("1回目で正常な結果が返る場合、2回目(リトライ)は呼ばれない(無駄なAPI呼び出しをしない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["JR東海道新幹線"],
      transferCount: 2,
      estimatedMinutes: 120,
    });

    const result = await generateRailRoute("key", NISHIYA, NAGOYA_KOKUSAI_CENTER);
    expect(result).not.toBeNull();
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });
});
