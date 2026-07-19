import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { serperImageSearch } from "../serper-image-search-client";

describe("serperImageSearch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("imagesを正規化して返す", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [
          { title: "大宮駅構内図", imageUrl: "https://example.com/a.png", imageWidth: 900, imageHeight: 1020 },
          { title: "他の画像", imageUrl: "https://example.com/b.jpg" },
        ],
      }),
    } as Response);

    const result = await serperImageSearch("test-key", "大宮駅 構内図");

    expect(result).toEqual([
      { title: "大宮駅構内図", imageUrl: "https://example.com/a.png" },
      { title: "他の画像", imageUrl: "https://example.com/b.jpg" },
    ]);
  });

  test("imageUrl/titleが欠けている項目は除外する", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [
          { title: "有効", imageUrl: "https://example.com/a.png" },
          { title: "", imageUrl: "https://example.com/b.png" },
          { title: "URL無し" },
        ],
      }),
    } as Response);

    const result = await serperImageSearch("test-key", "大宮駅 構内図");

    expect(result).toEqual([{ title: "有効", imageUrl: "https://example.com/a.png" }]);
  });

  test("HTTPエラー時は空配列を返す", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

    const result = await serperImageSearch("test-key", "大宮駅 構内図");

    expect(result).toEqual([]);
  });

  test("images配列でない応答は空配列を返す", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ images: "not-an-array" }),
    } as Response);

    const result = await serperImageSearch("test-key", "大宮駅 構内図");

    expect(result).toEqual([]);
  });

  test("fetchが例外を投げても空配列を返す", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));

    const result = await serperImageSearch("test-key", "大宮駅 構内図");

    expect(result).toEqual([]);
  });

  test("APIキーとクエリがリクエストに正しく渡る", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ images: [] }),
    } as Response);

    await serperImageSearch("my-api-key", "東京駅 JR東日本 構内図");

    expect(fetch).toHaveBeenCalledWith(
      "https://google.serper.dev/images",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-API-KEY": "my-api-key" }),
        body: expect.stringContaining("東京駅 JR東日本 構内図"),
      })
    );
  });
});
