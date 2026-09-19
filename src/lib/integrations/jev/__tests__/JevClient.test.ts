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

    it("TypeSafe systemOne呼び出しが成功した場合はokを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      const { TypeSafeClient } = await import("@typesafe-ai/sdk");
      const mockSystemOne = vi.fn().mockResolvedValue({ answers: { pong: { noul: 1 } } });
      vi.mocked(TypeSafeClient).mockImplementation(() => ({ systemOne: mockSystemOne }) as unknown as InstanceType<typeof TypeSafeClient>);

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: true });
      expect(TypeSafeClient).toHaveBeenCalledWith({
        apiKey: "test-key",
        timeout: 5000,
      });
    });

    it("TypeSafe APIがエラーを返す場合はupstream_errorを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      const { TypeSafeClient } = await import("@typesafe-ai/sdk");
      const mockSystemOne = vi.fn().mockRejectedValue(new Error("API error"));
      vi.mocked(TypeSafeClient).mockImplementation(() => ({ systemOne: mockSystemOne }) as unknown as InstanceType<typeof TypeSafeClient>);

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, reason: "upstream_error" });
    });

    it("認証エラー時はauth_errorを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      const { TypeSafeClient } = await import("@typesafe-ai/sdk");
      const mockSystemOne = vi.fn().mockRejectedValue(new Error("401 Unauthorized"));
      vi.mocked(TypeSafeClient).mockImplementation(() => ({ systemOne: mockSystemOne }) as unknown as InstanceType<typeof TypeSafeClient>);

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, reason: "auth_error" });
    });

    it("タイムアウト時はtimeoutエラーを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      const { TypeSafeClient } = await import("@typesafe-ai/sdk");
      const mockSystemOne = vi.fn().mockRejectedValue(new Error("timeout"));
      vi.mocked(TypeSafeClient).mockImplementation(() => ({ systemOne: mockSystemOne }) as unknown as InstanceType<typeof TypeSafeClient>);

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, reason: "timeout" });
    });

    it("AbortError時はtimeoutエラーを返す", async () => {
      process.env.JEV_API_KEY = "test-key";
      const { TypeSafeClient } = await import("@typesafe-ai/sdk");
      const error = new Error("Aborted");
      error.name = "AbortError";
      const mockSystemOne = vi.fn().mockRejectedValue(error);
      vi.mocked(TypeSafeClient).mockImplementation(() => ({ systemOne: mockSystemOne }) as unknown as InstanceType<typeof TypeSafeClient>);

      const result = await checkJevHealth();

      expect(result).toEqual({ ok: false, reason: "timeout" });
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
