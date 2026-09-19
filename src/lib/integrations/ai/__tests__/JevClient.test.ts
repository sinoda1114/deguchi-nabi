import { describe, expect, test, afterEach, vi, beforeEach } from "vitest";
import {
  isJevAvailable,
  createJevConfig,
  evaluateRetryGate,
  evaluateRouteConsistency,
  evaluateFacilityCompleteness,
  selectBestFacilityPair,
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

  describe("evaluateFacilityCompleteness (Phase 2-C)", () => {
    test("改札のみ（exitなし）の場合、JEVがretry推奨", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          isCompleteBothNeeded: {
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
        state: "confirmed",
        pair: {
          gate: { name: "道玄坂改札", confidenceLevel: "medium" },
          exit: null,
          reason: null,
        },
      };

      const result = await evaluateFacilityCompleteness(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(true);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain("exit");
      expect(result.reason).toContain("不完全");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("出口のみ（gateなし）の場合、JEVがretry推奨", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          isCompleteBothNeeded: {
            type: "noul",
            noul: 0.3,
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
          gate: null,
          exit: { name: "A1出口", confidenceLevel: "medium" },
          reason: null,
        },
      };

      const result = await evaluateFacilityCompleteness(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(true);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain("gate");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("両方揃っている場合、ルールベースで完全判定（JEV呼び出しなし）", async () => {
      const mockSystemOne = vi.fn();

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

      const result = await evaluateFacilityCompleteness(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(false);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.reason).toContain("confirmed状態（gate・exit両方あり）");
      expect(mockSystemOne).not.toHaveBeenCalled();
    });

    test("unavailable状態の場合、Phase 1に委ねる（例外をスロー）", async () => {
      const mockSystemOne = vi.fn();

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "unavailable",
        reason: "改札・出口の情報が確認できませんでした",
      };

      await expect(evaluateFacilityCompleteness(facility, { apiKey: "test_key" })).rejects.toThrow("Phase 2-C: unavailable state should be handled by Phase 1");
      expect(mockSystemOne).not.toHaveBeenCalled();
    });

    test("alternatives状態の場合、ルールベースで十分判定（JEV呼び出しなし）", async () => {
      const mockSystemOne = vi.fn();

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

      const result = await evaluateFacilityCompleteness(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(false);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
      expect(result.reason).toContain("alternatives状態");
      expect(mockSystemOne).not.toHaveBeenCalled();
    });

    test("小規模駅で片方だけで十分な場合、JEVがretry不要と判定", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          isCompleteBothNeeded: {
            type: "noul",
            noul: 0.8,
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
          gate: { name: "改札", confidenceLevel: "medium" },
          exit: null,
          reason: null,
        },
      };

      const result = await evaluateFacilityCompleteness(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(false);
      expect(result.isComplete).toBe(true);
      expect(result.reason).toContain("十分な情報");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("タイムアウト時は例外を再スロー（Phase 1へフォールバック）", async () => {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";

      const mockSystemOne = vi.fn().mockRejectedValue(abortError);

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "confirmed",
        pair: {
          gate: { name: "道玄坂改札", confidenceLevel: "medium" },
          exit: null,
          reason: null,
        },
      };

      await expect(evaluateFacilityCompleteness(facility, { apiKey: "test_key", timeoutMs: 100 })).rejects.toThrow("AbortError");
    });

    test("API呼び出しエラー時は例外を再スロー（Phase 1へフォールバック）", async () => {
      const mockSystemOne = vi.fn().mockRejectedValue(new Error("Network error"));

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "confirmed",
        pair: {
          gate: { name: "道玄坂改札", confidenceLevel: "medium" },
          exit: null,
          reason: null,
        },
      };

      await expect(evaluateFacilityCompleteness(facility, { apiKey: "test_key" })).rejects.toThrow("Network error");
    });
  });

  describe("selectBestFacilityPair (Phase 2-B)", () => {
    test("複数候補から最適な1つを選択（候補1を選択）", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          bestCandidateIndex: {
            type: "noul",
            noul: 0.0,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const pairs = [
        { gate: { name: "道玄坂改札" }, exit: { name: "A1出口" }, reason: "目的地に最も近い" },
        { gate: { name: "道玄坂改札" }, exit: { name: "A2出口" }, reason: null },
      ];

      const context = {
        destinationHint: "ウエチャベ",
        arrivalStationName: "渋谷駅",
        searchText: "A1出口が目的地に最も近いです。",
      };

      const result = await selectBestFacilityPair(pairs, context, { apiKey: "test_key" });
      expect(result.selectedIndex).toBe(0);
      expect(result.reason).toContain("候補1を選択");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("複数候補から最適な1つを選択（候補2を選択）", async () => {
      const mockSystemOne = vi.fn().mockResolvedValue({
        answers: {
          bestCandidateIndex: {
            type: "noul",
            noul: 1.0,
          },
        },
      });

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const pairs = [
        { gate: { name: "道玄坂改札" }, exit: { name: "A1出口" }, reason: null },
        { gate: { name: "道玄坂改札" }, exit: { name: "A2出口" }, reason: "エレベーターあり" },
      ];

      const context = {
        destinationHint: "ウエチャベ",
        arrivalStationName: "渋谷駅",
        searchText: "A2出口にはエレベーターがあり、目的地へのアクセスが便利です。",
      };

      const result = await selectBestFacilityPair(pairs, context, { apiKey: "test_key" });
      expect(result.selectedIndex).toBe(1);
      expect(result.reason).toContain("候補2を選択");
      expect(mockSystemOne).toHaveBeenCalledTimes(1);
    });

    test("候補が1つ以下の場合は例外をスロー", async () => {
      const mockSystemOne = vi.fn();

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const pairs = [{ gate: { name: "道玄坂改札" }, exit: { name: "A1出口" }, reason: null }];

      const context = {
        destinationHint: "ウエチャベ",
        arrivalStationName: "渋谷駅",
        searchText: "",
      };

      await expect(selectBestFacilityPair(pairs, context, { apiKey: "test_key" })).rejects.toThrow("at least 2 pairs");
      expect(mockSystemOne).not.toHaveBeenCalled();
    });

    test("タイムアウト時は例外を再スロー（alternatives維持）", async () => {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";

      const mockSystemOne = vi.fn().mockRejectedValue(abortError);

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const pairs = [
        { gate: { name: "道玄坂改札" }, exit: { name: "A1出口" }, reason: null },
        { gate: { name: "道玄坂改札" }, exit: { name: "A2出口" }, reason: null },
      ];

      const context = {
        destinationHint: "ウエチャベ",
        arrivalStationName: "渋谷駅",
        searchText: "",
      };

      await expect(selectBestFacilityPair(pairs, context, { apiKey: "test_key", timeoutMs: 100 })).rejects.toThrow("AbortError");
    });

    test("API呼び出しエラー時は例外を再スロー（alternatives維持）", async () => {
      const mockSystemOne = vi.fn().mockRejectedValue(new Error("Network error"));

      vi.mocked(TypeSafeClient).mockImplementation(function (this: unknown) {
        return {
          systemOne: mockSystemOne,
        } as unknown as TypeSafeClient;
      } as unknown as typeof TypeSafeClient);

      const pairs = [
        { gate: { name: "道玄坂改札" }, exit: { name: "A1出口" }, reason: null },
        { gate: { name: "道玄坂改札" }, exit: { name: "A2出口" }, reason: null },
      ];

      const context = {
        destinationHint: "ウエチャベ",
        arrivalStationName: "渋谷駅",
        searchText: "",
      };

      await expect(selectBestFacilityPair(pairs, context, { apiKey: "test_key" })).rejects.toThrow("Network error");
    });
  });
});
