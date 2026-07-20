import { afterEach, describe, expect, test, vi } from "vitest";
import {
  generateStructuredContent,
  searchAndGenerateStructuredContent,
  searchAndGenerateStructuredContentWithImage,
} from "../GeminiClient";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("callGemini のタイムアウト設定", () => {
  const originalFetch = global.fetch;
  const originalAbortTimeout = AbortSignal.timeout;

  afterEach(() => {
    global.fetch = originalFetch;
    AbortSignal.timeout = originalAbortTimeout;
    vi.restoreAllMocks();
  });

  test("通常の構造化生成(検索なし)は短いタイムアウトのまま", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] })
    ) as unknown as typeof fetch;

    await generateStructuredContent("key", "prompt", {}, "gemini-3.5-flash");

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy.mock.calls[0][0]).toBeLessThanOrEqual(15000);
  });

  test("Search Grounding(検索フェーズ→抽出フェーズ)は検索フェーズのみ長いタイムアウトを使う", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi
      .fn()
      // 1回目: 検索フェーズ(google_search tool、groundingMetadata付き)
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: "検索結果テキスト" }] },
              groundingMetadata: { webSearchQueries: ["q1"] },
            },
          ],
        })
      )
      // 2回目: 抽出フェーズ(検索結果テキストをJSON構造化)
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"lines":["JR山手線"]}' }] } }],
        })
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await searchAndGenerateStructuredContent(
      "key",
      "search prompt",
      "extract",
      {},
      "gemini-3.5-flash"
    );

    // 戻り値そのものを検証することで、タイムアウト値だけでなく一連の処理が
    // 正しく完走している(抽出フェーズが検索結果を握りつぶしていない)ことを保証する。
    expect(result).toEqual({ lines: ["JR山手線"] });
    // 実測(西谷→国際センター駅、遠距離・複数県の同名駅の曖昧性解消込み)で
    // 検索フェーズ単体が35.1秒かかったため、それを上回る猶予(55秒)が検索フェーズのみに
    // 適用され、抽出フェーズは従来の短いタイムアウト(15秒)のままであることを検証する。
    expect(timeoutSpy.mock.calls.map(([timeout]) => timeout)).toEqual([55_000, 15_000]);
  });

  test("画像付きSearch Groundingも検索フェーズのみ長いタイムアウトを使う", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: "検索+画像結果テキスト" }] },
              groundingMetadata: { webSearchQueries: ["q1"] },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"facilities":[]}' }] } }],
        })
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await searchAndGenerateStructuredContentWithImage(
      "key",
      "search prompt",
      "extract",
      {},
      { data: "base64imagedata", mimeType: "image/png" },
      "gemini-3.5-flash"
    );

    expect(result).toEqual({ facilities: [] });
    expect(timeoutSpy.mock.calls.map(([timeout]) => timeout)).toEqual([55_000, 15_000]);
  });

  test("画像パートが検索フェーズのリクエストボディに含まれる", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: "テキスト" }] },
              groundingMetadata: { webSearchQueries: ["q1"] },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ candidates: [{ content: { parts: [{ text: "{}" }] } }] })
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchAndGenerateStructuredContentWithImage(
      "key",
      "search prompt",
      "extract",
      {},
      { data: "base64imagedata", mimeType: "image/png" },
      "gemini-3.5-flash"
    );

    const firstCallBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstCallBody.contents[0].parts).toContainEqual({
      inline_data: { mime_type: "image/png", data: "base64imagedata" },
    });
    expect(firstCallBody.tools).toEqual([{ google_search: {} }]);
  });

  test("検索が実行されなかった(groundingMetadataが無い)場合はnullを返す", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "テキスト" }] } }] })
    ) as unknown as typeof fetch;

    const result = await searchAndGenerateStructuredContentWithImage(
      "key",
      "search prompt",
      "extract",
      {},
      { data: "base64imagedata", mimeType: "image/png" },
      "gemini-3.5-flash"
    );

    expect(result).toBeNull();
  });
});
