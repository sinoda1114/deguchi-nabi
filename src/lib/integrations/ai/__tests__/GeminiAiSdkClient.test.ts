import { afterEach, describe, expect, test, vi } from "vitest";

// Vercel AI SDK (`ai` / `@ai-sdk/google`) をモックし、SDK内部のHTTP実装ではなく
// GeminiAiSdkClient.ts が SDK 関数へ正しい引数(スキーマ・タイムアウト・
// テレメトリ設定)を渡しているかを検証する。GeminiClient.test.ts が
// fetchレベルでモックしていたのと同じ思想を、SDK関数レベルに置き換えたもの。
const generateObjectMock = vi.fn();
const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
  generateText: (...args: unknown[]) => generateTextMock(...args),
  jsonSchema: (schema: unknown) => schema,
}));

const googleSearchToolMock = vi.fn(() => ({ type: "google_search" }));
function createFakeGoogleProvider() {
  const provider = vi.fn((modelId: string) => ({ modelId }));
  (provider as unknown as { tools: { googleSearch: typeof googleSearchToolMock } }).tools = {
    googleSearch: googleSearchToolMock,
  };
  return provider;
}
const fakeGoogleProvider = createFakeGoogleProvider();
const createGoogleMock = vi.fn((..._args: unknown[]) => fakeGoogleProvider);

vi.mock("@ai-sdk/google", () => ({
  createGoogle: (...args: unknown[]) => createGoogleMock(...args),
}));

const scheduleLangfuseFlushMock = vi.fn();
vi.mock("../langfuse-flush", () => ({
  scheduleLangfuseFlush: () => scheduleLangfuseFlushMock(),
}));

describe("GeminiAiSdkClient", () => {
  const originalAbortTimeout = AbortSignal.timeout;

  afterEach(() => {
    AbortSignal.timeout = originalAbortTimeout;
    vi.clearAllMocks();
  });

  describe("generateStructuredContent", () => {
    test("正常系: generateObjectの結果をそのまま返す", async () => {
      generateObjectMock.mockResolvedValue({ object: { ok: true } });

      const { generateStructuredContent } = await import("../GeminiAiSdkClient");
      const result = await generateStructuredContent("key", "prompt", { type: "object" });

      expect(result).toEqual({ ok: true });
      expect(createGoogleMock).toHaveBeenCalledWith({ apiKey: "key" });
      expect(generateObjectMock).toHaveBeenCalledTimes(1);
      const callArgs = generateObjectMock.mock.calls[0][0];
      expect(callArgs.prompt).toBe("prompt");
      expect(callArgs.telemetry?.isEnabled).toBe(true);
    });

    test("タイムアウト設定は15秒以内", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      generateObjectMock.mockResolvedValue({ object: {} });

      const { generateStructuredContent } = await import("../GeminiAiSdkClient");
      await generateStructuredContent("key", "prompt", { type: "object" });

      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      expect(timeoutSpy.mock.calls[0][0]).toBeLessThanOrEqual(15000);
    });

    test("タイムアウト・API障害時はnullを返す(例外を投げない)", async () => {
      generateObjectMock.mockRejectedValue(new Error("timeout"));

      const { generateStructuredContent } = await import("../GeminiAiSdkClient");
      const result = await generateStructuredContent("key", "prompt", { type: "object" });

      expect(result).toBeNull();
    });

    test("不正な応答(NoObjectGeneratedError相当)はnullを返す", async () => {
      generateObjectMock.mockRejectedValue(new Error("NoObjectGeneratedError"));

      const { generateStructuredContent } = await import("../GeminiAiSdkClient");
      const result = await generateStructuredContent("key", "prompt", { type: "object" });

      expect(result).toBeNull();
    });

    test("responseSchemaがtypeフィールドを持たない場合はnullを返す(例外を投げない、不正スキーマがそのままAI SDKへ渡らないようにするガード)", async () => {
      generateObjectMock.mockResolvedValue({ object: { ok: true } });

      const { generateStructuredContent } = await import("../GeminiAiSdkClient");
      const result = await generateStructuredContent("key", "prompt", {});

      expect(result).toBeNull();
      expect(generateObjectMock).not.toHaveBeenCalled();
    });

    test("responseSchemaが配列の場合はnullを返す(例外を投げない)", async () => {
      generateObjectMock.mockResolvedValue({ object: { ok: true } });

      const { generateStructuredContent } = await import("../GeminiAiSdkClient");
      const result = await generateStructuredContent("key", "prompt", [] as unknown as object);

      expect(result).toBeNull();
      expect(generateObjectMock).not.toHaveBeenCalled();
    });

    test("成功時もLangfuseへのflushをスケジュールする", async () => {
      generateObjectMock.mockResolvedValue({ object: { ok: true } });

      const { generateStructuredContent } = await import("../GeminiAiSdkClient");
      await generateStructuredContent("key", "prompt", { type: "object" });

      expect(scheduleLangfuseFlushMock).toHaveBeenCalledTimes(1);
    });

    test("失敗時(null返却)もLangfuseへのflushをスケジュールする(telemetryは成否問わず送る)", async () => {
      generateObjectMock.mockRejectedValue(new Error("timeout"));

      const { generateStructuredContent } = await import("../GeminiAiSdkClient");
      await generateStructuredContent("key", "prompt", { type: "object" });

      expect(scheduleLangfuseFlushMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("searchAndGenerateStructuredContent", () => {
    test("正常系: 検索実行(groundingMetadata有り)→抽出の2段呼び出しで結果を返す", async () => {
      generateTextMock.mockResolvedValue({
        text: "検索結果テキスト",
        providerMetadata: {
          google: { groundingMetadata: { webSearchQueries: ["q1"] } },
        },
      });
      generateObjectMock.mockResolvedValue({ object: { steps: [] } });

      const { searchAndGenerateStructuredContent } = await import("../GeminiAiSdkClient");
      const result = await searchAndGenerateStructuredContent(
        "key",
        "search prompt",
        "extract",
        { type: "object" }
      );

      expect(result).toEqual({ steps: [] });
      expect(generateTextMock).toHaveBeenCalledTimes(1);
      const searchArgs = generateTextMock.mock.calls[0][0];
      expect(searchArgs.tools.google_search).toBeDefined();
      expect(generateObjectMock).toHaveBeenCalledTimes(1);
      const extractArgs = generateObjectMock.mock.calls[0][0];
      expect(extractArgs.prompt).toContain("検索結果テキスト");
      expect(extractArgs.prompt).toContain("extract");
    });

    test("検索フェーズは55秒・抽出フェーズは15秒のタイムアウトを使う", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      generateTextMock.mockResolvedValue({
        text: "検索結果テキスト",
        providerMetadata: {
          google: { groundingMetadata: { webSearchQueries: ["q1"] } },
        },
      });
      generateObjectMock.mockResolvedValue({ object: {} });

      const { searchAndGenerateStructuredContent } = await import("../GeminiAiSdkClient");
      await searchAndGenerateStructuredContent("key", "search prompt", "extract", {
        type: "object",
      });

      expect(timeoutSpy.mock.calls.map(([timeout]) => timeout)).toEqual([55_000, 15_000]);
    });

    test("検索が実行されなかった(groundingMetadataなし)場合はnullを返し抽出フェーズを呼ばない", async () => {
      generateTextMock.mockResolvedValue({
        text: "検索結果テキスト",
        providerMetadata: { google: { groundingMetadata: { webSearchQueries: [] } } },
      });

      const { searchAndGenerateStructuredContent } = await import("../GeminiAiSdkClient");
      const result = await searchAndGenerateStructuredContent("key", "search prompt", "extract", {});

      expect(result).toBeNull();
      expect(generateObjectMock).not.toHaveBeenCalled();
    });

    test("検索フェーズが例外を投げた場合もnullを返す(例外を投げない)", async () => {
      generateTextMock.mockRejectedValue(new Error("timeout"));

      const { searchAndGenerateStructuredContent } = await import("../GeminiAiSdkClient");
      const result = await searchAndGenerateStructuredContent("key", "search prompt", "extract", {});

      expect(result).toBeNull();
    });

    test("成功時もLangfuseへのflushをスケジュールする", async () => {
      generateTextMock.mockResolvedValue({
        text: "検索結果テキスト",
        providerMetadata: {
          google: { groundingMetadata: { webSearchQueries: ["q1"] } },
        },
      });
      generateObjectMock.mockResolvedValue({ object: { steps: [] } });

      const { searchAndGenerateStructuredContent } = await import("../GeminiAiSdkClient");
      await searchAndGenerateStructuredContent("key", "search prompt", "extract", {
        type: "object",
      });

      expect(scheduleLangfuseFlushMock).toHaveBeenCalledTimes(1);
    });

    test("検索フェーズが例外を投げた場合もLangfuseへのflushをスケジュールする", async () => {
      generateTextMock.mockRejectedValue(new Error("timeout"));

      const { searchAndGenerateStructuredContent } = await import("../GeminiAiSdkClient");
      await searchAndGenerateStructuredContent("key", "search prompt", "extract", {});

      expect(scheduleLangfuseFlushMock).toHaveBeenCalledTimes(1);
    });
  });
});
