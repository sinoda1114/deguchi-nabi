import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkJevHealth, callJevSafely } from "../JevClient";

describe("JevClient", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe("checkJevHealth", () => {
    it("JEV_API_KEYが未設定の場合はmissing_keyエラーを返す", async () => {
      delete process.env.JEV_API_KEY;

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, error: "missing_key" });
    });

    it("APIが200を返す場合はokを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: true });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/health"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-key",
          }),
        })
      );
    });

    it("APIがエラーを返す場合はupstream_errorを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, error: "upstream_error" });
    });

    it("タイムアウト時はtimeoutエラーを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            setTimeout(() => reject(error), 100);
          })
      );

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, error: "timeout" });
    });

    it("ネットワークエラー時はupstream_errorを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, error: "upstream_error" });
    });
  });

  describe("callJevSafely", () => {
    it("成功時は結果を返す", async () => {
      const fn = vi.fn().mockResolvedValue({ data: "test" });

      const result = await callJevSafely(fn);

      expect(result).toEqual({ data: "test" });
      expect(fn).toHaveBeenCalled();
    });

    it("エラー時はnullを返してログに記録する", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fn = vi.fn().mockRejectedValue(new Error("Test error"));

      const result = await callJevSafely(fn);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[JevClient] fail-open: error caught",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
