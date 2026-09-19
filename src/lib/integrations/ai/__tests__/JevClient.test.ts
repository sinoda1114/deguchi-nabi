import { describe, expect, test, afterEach, vi, beforeEach } from "vitest";
import {
  isJevAvailable,
  createJevConfig,
  evaluateRetryGate,
  evaluateRouteConsistency,
} from "../JevClient";
import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";
import type { RawNamedFacility, SingleCallNavigatorGuide } from "../single-call-navigator";
import { TypeSafeClient } from "@typesafe-ai/sdk";

vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: vi.fn(),
  noul: vi.fn((instructions, criteria) => ({
    type: "noul",
    instructions,
    criteria,
  })),
}));

describe("JevClient", () => {
  const originalEnv = process.env.JEV_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.JEV_API_KEY = originalEnv;
    } else {
      delete process.env.JEV_API_KEY;
    }
  });

  describe("isJevAvailable", () => {
    test("JEV_API_KEYが設定されている場合、trueを返す", () => {
      process.env.JEV_API_KEY = "test_api_key";
      expect(isJevAvailable()).toBe(true);
    });

    test("JEV_API_KEYが未設定の場合、falseを返す", () => {
      delete process.env.JEV_API_KEY;
      expect(isJevAvailable()).toBe(false);
    });

    test("JEV_API_KEYが空文字の場合、falseを返す", () => {
      process.env.JEV_API_KEY = "";
      expect(isJevAvailable()).toBe(false);
    });
  });

  describe("createJevConfig", () => {
    test("JEV_API_KEYが設定されている場合、設定オブジェクトを返す", () => {
      process.env.JEV_API_KEY = "test_api_key";
      const config = createJevConfig();
      expect(config).toEqual({ apiKey: "test_api_key" });
    });

    test("JEV_API_KEYが未設定の場合、nullを返す", () => {
      delete process.env.JEV_API_KEY;
      const config = createJevConfig();
      expect(config).toBeNull();
    });
  });

  describe("evaluateRetryGate", () => {
    test("unavailable状態でJEVが高確信度でリトライ必要と判定", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          needsRetry: {
            type: "noul",
            noul: 0.85,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "unavailable",
        reason: "改札・出口の情報が確認できませんでした",
      };

      const result = await evaluateRetryGate(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(true);
      expect(result.reason).toContain("JEV判定");
      expect(result.reason).toContain("0.85");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("unavailable状態でもJEVが情報十分と判定すればリトライ不要", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          needsRetry: {
            type: "noul",
            noul: 0.2,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "unavailable",
        reason: "改札・出口の情報が確認できませんでした",
      };

      const result = await evaluateRetryGate(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(false);
      expect(result.reason).toContain("JEV判定");
      expect(result.reason).toContain("0.80");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("confirmed状態の場合、JEVはリトライ不要と判定", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          needsRetry: {
            type: "noul",
            noul: 0.1,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "confirmed",
        pair: {
          gate: { name: "道玄坂改札", confidenceLevel: "medium" },
          exit: { name: "A1出口", confidenceLevel: "medium" },
          reason: null,
        },
      };

      const result = await evaluateRetryGate(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(false);
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("alternatives状態の場合、JEVはリトライ不要と判定", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          needsRetry: {
            type: "noul",
            noul: 0.15,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "alternatives",
        pairs: [
          {
            gate: { name: "1階改札", confidenceLevel: "medium" },
            exit: { name: "みなみ西口", confidenceLevel: "medium" },
            reason: null,
          },
          {
            gate: { name: "1階改札", confidenceLevel: "medium" },
            exit: { name: "5番街出口", confidenceLevel: "medium" },
            reason: null,
          },
        ],
      };

      const result = await evaluateRetryGate(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(false);
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("タイムアウト時は例外を再スロー（呼び出し側でルールベース判定へフォールバック）", async () => {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";

      const mockSystemOne = vi.fn().mockRejectedValue(abortError);

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "unavailable",
        reason: "改札・出口の情報が確認できませんでした",
      };

      await expect(evaluateRetryGate(facility, { apiKey: "test_key", timeoutMs: 100 })).rejects.toThrow("AbortError");
    });

    test("API呼び出しエラー時は例外を再スロー（呼び出し側でルールベース判定へフォールバック）", async () => {
      const mockSystemOne = vi.fn().mockRejectedValue(new Error("Network error"));

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "unavailable",
        reason: "改札・出口の情報が確認できませんでした",
      };

      await expect(evaluateRetryGate(facility, { apiKey: "test_key" })).rejects.toThrow("Network error");
    });
  });

  describe("evaluateRouteConsistency", () => {
    const createGuide = (
      lines: string[],
      transferCount: number,
      platform: string | null
    ): SingleCallNavigatorGuide => ({
      lines,
      transferCount,
      estimatedMinutes: 35,
      arrivalPlatformNumber: platform,
      boarding: null,
      facility: { state: "unavailable", reason: "テスト用" },
    });

    test("JEVが意味的に一致と判定（「東横線」vs「東急東横線」）", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          sameRoute: {
            type: "noul",
            noul: 0.9,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const a = createGuide(["東横線"], 0, "3");
      const b = createGuide(["東急東横線"], 0, "3");

      const result = await evaluateRouteConsistency(a, b, { apiKey: "test_key" });
      expect(result.isConsistent).toBe(true);
      expect(result.reason).toContain("同一ルート");
      expect(result.reason).toContain("0.90");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("JEVが不一致と判定（「相鉄本線」vs「東急東横線」）", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          sameRoute: {
            type: "noul",
            noul: 0.1,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const a = createGuide(["相鉄本線"], 0, null);
      const b = createGuide(["東急東横線"], 0, null);

      const result = await evaluateRouteConsistency(a, b, { apiKey: "test_key" });
      expect(result.isConsistent).toBe(false);
      expect(result.reason).toContain("異なるルート");
      expect(result.reason).toContain("0.90");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("番線表記揺れ（「3番線」vs「3番ホーム」）をJEVが吸収", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          sameRoute: {
            type: "noul",
            noul: 0.95,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const a = createGuide(["東急東横線"], 0, "3番線");
      const b = createGuide(["東急東横線"], 0, "3番ホーム");

      const result = await evaluateRouteConsistency(a, b, { apiKey: "test_key" });
      expect(result.isConsistent).toBe(true);
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("タイムアウト時は例外を再スロー（呼び出し側でルールベース判定へフォールバック）", async () => {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";

      const mockSystemOne = vi.fn().mockRejectedValue(abortError);

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const a = createGuide(["東急東横線"], 0, "3");
      const b = createGuide(["東急東横線"], 0, "3番線");

      await expect(evaluateRouteConsistency(a, b, { apiKey: "test_key", timeoutMs: 100 })).rejects.toThrow("AbortError");
    });

    test("API呼び出しエラー時は例外を再スロー（呼び出し側でルールベース判定へフォールバック）", async () => {
      const mockSystemOne = vi.fn().mockRejectedValue(new Error("Network error"));

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const a = createGuide(["東急東横線"], 0, "3");
      const b = createGuide(["東急東横線"], 0, "3番線");

      await expect(evaluateRouteConsistency(a, b, { apiKey: "test_key" })).rejects.toThrow("Network error");
    });
  });
});
