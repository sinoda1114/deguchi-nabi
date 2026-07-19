import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchPageAsMarkdown } from "../jina-reader-client";

function textResponse(text: string, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => text,
  } as Response;
}

describe("fetchPageAsMarkdown", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("正常時は本文テキストを返す", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(textResponse("# 見出し\n本文テキスト")) as unknown as typeof fetch;

    const result = await fetchPageAsMarkdown(null, "https://www.jreast.co.jp/x");
    expect(result).toBe("# 見出し\n本文テキスト");
  });

  test("本文が長い場合は先頭8000字にクランプする", async () => {
    const longText = "あ".repeat(9000);
    global.fetch = vi
      .fn()
      .mockResolvedValue(textResponse(longText)) as unknown as typeof fetch;

    const result = await fetchPageAsMarkdown(null, "https://example.com");
    expect(result).toHaveLength(8000);
  });

  test("r.jina.ai/${url}へGETし、X-Return-Format: markdownを送る。apiKeyがあればAuthorizationを付与", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("本文"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchPageAsMarkdown("jina-key", "https://www.jreast.co.jp/x");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://r.jina.ai/https://www.jreast.co.jp/x");
    expect(init.method ?? "GET").toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Return-Format"]).toBe("markdown");
    expect(headers["Authorization"]).toBe("Bearer jina-key");
  });

  test("apiKeyがnullの場合はAuthorizationヘッダを付けない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("本文"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchPageAsMarkdown(null, "https://example.com");

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  test("非200の場合はnullを返す", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(textResponse("", false)) as unknown as typeof fetch;

    const result = await fetchPageAsMarkdown(null, "https://example.com");
    expect(result).toBeNull();
  });

  test("fetchが例外(タイムアウト等)を投げてもnullを返す", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;

    const result = await fetchPageAsMarkdown(null, "https://example.com");
    expect(result).toBeNull();
  });
});
