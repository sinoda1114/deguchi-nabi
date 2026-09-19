import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkJevHealth, callJevSafely } from "../JevClient";

vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: vi.fn(),
  noul: vi.fn((q, opts) => ({ question: q, options: opts })),
}));

describe("JevClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("checkJevHealth", () => {
    it("JEV_API_KEYが未設定の場合はmissing_keyエラーを返す", async () => {
      delete process.env.JEV_API_KEY;

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, reason: "missing_key" });
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
