import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const serperImageSearch = vi.fn();
vi.mock("../serper-image-search-client", () => ({
  serperImageSearch: (...args: unknown[]) => serperImageSearch(...args),
}));

const fetchImageAsInlineData = vi.fn();
vi.mock("../station-image-fetch", () => ({
  fetchImageAsInlineData: (...args: unknown[]) => fetchImageAsInlineData(...args),
}));

const { findStationFloorMapImage } = await import("../facilities-image-search");

describe("findStationFloorMapImage", () => {
  beforeEach(() => {
    serperImageSearch.mockReset();
    fetchImageAsInlineData.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("最初の候補が取得できればそれを返す", async () => {
    serperImageSearch.mockResolvedValue([
      { title: "大宮駅構内図", imageUrl: "https://example.com/a.png" },
      { title: "大宮駅構内図2", imageUrl: "https://example.com/b.png" },
    ]);
    fetchImageAsInlineData.mockResolvedValueOnce({ data: "base64data", mimeType: "image/png" });

    const result = await findStationFloorMapImage("serper-key", "大宮駅", "JR東日本");

    expect(result).toEqual({ data: "base64data", mimeType: "image/png" });
    expect(fetchImageAsInlineData).toHaveBeenCalledTimes(1);
  });

  test("最初の候補が取得失敗したら次の候補を試す(有界フォールバック)", async () => {
    serperImageSearch.mockResolvedValue([
      { title: "取得失敗する画像", imageUrl: "https://example.com/blocked.png" },
      { title: "取得できる画像", imageUrl: "https://example.com/ok.png" },
    ]);
    fetchImageAsInlineData
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ data: "ok-data", mimeType: "image/gif" });

    const result = await findStationFloorMapImage("serper-key", "大宮駅", "JR東日本");

    expect(result).toEqual({ data: "ok-data", mimeType: "image/gif" });
    expect(fetchImageAsInlineData).toHaveBeenCalledTimes(2);
  });

  test("全候補が取得失敗すればnullを返す", async () => {
    serperImageSearch.mockResolvedValue([
      { title: "画像1", imageUrl: "https://example.com/a.png" },
      { title: "画像2", imageUrl: "https://example.com/b.png" },
    ]);
    fetchImageAsInlineData.mockResolvedValue(null);

    const result = await findStationFloorMapImage("serper-key", "大宮駅", "JR東日本");

    expect(result).toBeNull();
  });

  test("検索結果が空ならnullを返し、fetchは呼ばない", async () => {
    serperImageSearch.mockResolvedValue([]);

    const result = await findStationFloorMapImage("serper-key", "大宮駅", "JR東日本");

    expect(result).toBeNull();
    expect(fetchImageAsInlineData).not.toHaveBeenCalled();
  });

  test("試行する候補数には上限がある(無制限フォールバックを防ぐ)", async () => {
    serperImageSearch.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        title: `画像${i}`,
        imageUrl: `https://example.com/${i}.png`,
      }))
    );
    fetchImageAsInlineData.mockResolvedValue(null);

    await findStationFloorMapImage("serper-key", "大宮駅", "JR東日本");

    expect(fetchImageAsInlineData.mock.calls.length).toBeLessThanOrEqual(5);
  });

  test("事業者名を含んだクエリで検索する(別駅・古い構内図の混入対策)", async () => {
    serperImageSearch.mockResolvedValue([]);

    await findStationFloorMapImage("serper-key", "大宮駅", "JR東日本");

    expect(serperImageSearch).toHaveBeenCalledWith("serper-key", expect.stringContaining("大宮駅"));
    expect(serperImageSearch).toHaveBeenCalledWith(
      "serper-key",
      expect.stringContaining("JR東日本")
    );
  });

  test("titleに駅名を含む候補を優先して試行する(/ai-review指摘、Low: 無関係画像の混入リスク低減)", async () => {
    serperImageSearch.mockResolvedValue([
      { title: "駅弁ランキング特集", imageUrl: "https://example.com/unrelated.png" },
      { title: "大宮駅構内図", imageUrl: "https://example.com/matching.png" },
    ]);
    fetchImageAsInlineData.mockResolvedValue({ data: "matched", mimeType: "image/png" });

    await findStationFloorMapImage("serper-key", "大宮駅", "JR東日本");

    expect(fetchImageAsInlineData).toHaveBeenNthCalledWith(1, "https://example.com/matching.png");
  });

  test("titleに駅名を含む候補が無くても、除外せず元の順序のまま全候補を試行する", async () => {
    serperImageSearch.mockResolvedValue([
      { title: "無関係な画像A", imageUrl: "https://example.com/a.png" },
      { title: "無関係な画像B", imageUrl: "https://example.com/b.png" },
    ]);
    fetchImageAsInlineData.mockResolvedValueOnce(null).mockResolvedValueOnce({
      data: "b-data",
      mimeType: "image/png",
    });

    const result = await findStationFloorMapImage("serper-key", "大宮駅", "JR東日本");

    expect(result).toEqual({ data: "b-data", mimeType: "image/png" });
    expect(fetchImageAsInlineData).toHaveBeenCalledTimes(2);
  });
});
