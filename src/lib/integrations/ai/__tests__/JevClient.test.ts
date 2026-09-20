import { describe, expect, test, afterEach, vi, beforeEach } from "vitest";
import {
  isJevAvailable,
  createJevConfig,
  evaluateRouteConsistency,
  evaluateFacilityJudgment,
} from "../JevClient";
import type { SingleCallNavigatorGuide } from "../single-call-navigator";
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

      await expect(evaluateRouteConsistency(a, b, { apiKey: "test_key", timeoutMs: 100 })).rejects.toThrow(
        "AbortError"
      );
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

  describe("evaluateFacilityJudgment", () => {
    test("1回のsystemOneでcatalog採用と候補スコアを返す", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          adoptCatalog: { type: "noul", noul: 0.9 },
          skipGeminiFacility: { type: "noul", noul: 0.8 },
          preferCandidate0: { type: "noul", noul: 0.2 },
          preferCandidate1: { type: "noul", noul: 0.7 },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const result = await evaluateFacilityJudgment(
        {
          destinationHint: "ウエチャベ",
          arrivalStationName: "渋谷駅",
          searchText: "道玄坂改札 A1出口",
          catalogPair: { gate: { name: "道玄坂改札" }, exit: { name: "A1出口" } },
          geminiPairs: [
            { gate: { name: "ハチ公改札" }, exit: { name: "ハチ公口" }, reason: null },
            { gate: { name: "道玄坂改札" }, exit: { name: "A1出口" }, reason: null },
          ],
          osmExitNames: [],
        },
        { apiKey: "test_key" }
      );

      expect(mockSystemOne).toHaveBeenCalledTimes(1);
      expect(result.adoptCatalog).toBe(true);
      expect(result.skipGeminiFacility).toBe(true);
      expect(result.candidateScores).toEqual([0.2, 0.7]);
    });

    test("タイムアウト時は例外を再スロー（パイプラインがfail-openする）", async () => {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";
      const mockSystemOne = vi.fn().mockRejectedValue(abortError);

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      await expect(
        evaluateFacilityJudgment(
          {
            destinationHint: "ウエチャベ",
            arrivalStationName: "渋谷駅",
            searchText: "",
            catalogPair: null,
            geminiPairs: [{ gate: { name: "道玄坂改札" }, exit: { name: "A1出口" }, reason: null }],
            osmExitNames: [],
          },
          { apiKey: "test_key", timeoutMs: 100 }
        )
      ).rejects.toThrow("AbortError");
    });
  });
});
