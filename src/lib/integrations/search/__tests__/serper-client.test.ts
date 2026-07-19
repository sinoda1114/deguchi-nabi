import { afterEach, describe, expect, test, vi } from "vitest";
import { serperSearch } from "../serper-client";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe("serperSearch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("正常レスポンスのorganic配列を{title,link,snippet,date}へparseする", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        organic: [
          {
            title: "渋谷駅 構内図",
            link: "https://www.jreast.co.jp/estation/stations/1234.html",
            snippet: "渋谷駅の構内図はこちら",
            date: "2025-01-01",
          },
          {
            title: "渋谷駅 出口案内",
            link: "https://www.tokyometro.jp/station/shibuya/",
            snippet: "出口案内",
          },
        ],
      })
    ) as unknown as typeof fetch;

    const results = await serperSearch("key", "渋谷駅 構内図");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "渋谷駅 構内図",
      link: "https://www.jreast.co.jp/estation/stations/1234.html",
      snippet: "渋谷駅の構内図はこちら",
      date: "2025-01-01",
    });
    expect(results[1].date).toBeUndefined();
  });

  test("X-API-KEYヘッダとJSONボディ(q/gl/hl/num)を送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ organic: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await serperSearch("secret-key", "渋谷駅 改札 出口", { num: 5 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://google.serper.dev/search");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("secret-key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ q: "渋谷駅 改札 出口", gl: "jp", hl: "ja", num: 5 });
  });

  test("非200の場合は[]を返す(例外を投げない)", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false)) as unknown as typeof fetch;

    const results = await serperSearch("key", "渋谷駅");
    expect(results).toEqual([]);
  });

  test("organicが配列でない場合は[]を返す", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ organic: null })) as unknown as typeof fetch;

    const results = await serperSearch("key", "渋谷駅");
    expect(results).toEqual([]);
  });

  test("fetchが例外(タイムアウト等)を投げても[]を返す", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;

    const results = await serperSearch("key", "渋谷駅");
    expect(results).toEqual([]);
  });

  test("linkまたはtitleが空白のみの項目は除外する(/ai-review指摘、Low: 無効な検索結果でJinaへの無駄なリクエストを避ける)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        organic: [
          { title: "   ", link: "https://www.jreast.co.jp/x", snippet: "" },
          { title: "有効なタイトル", link: "  \n  ", snippet: "" },
          {
            title: "渋谷駅 出口案内",
            link: "https://www.tokyometro.jp/station/shibuya/",
            snippet: "",
          },
        ],
      })
    ) as unknown as typeof fetch;

    const results = await serperSearch("key", "渋谷駅");

    expect(results).toHaveLength(1);
    expect(results[0].link).toBe("https://www.tokyometro.jp/station/shibuya/");
  });
});
