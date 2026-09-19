import { describe, expect, test, afterEach } from "vitest";
import {
  isJevAvailable,
  createJevConfig,
  evaluateRetryGate,
} from "../JevClient";
import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";
import type { RawNamedFacility } from "../single-call-navigator";

describe("JevClient", () => {
  const originalEnv = process.env.JEV_API_KEY;

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
    test("unavailable状態の場合、shouldRetry=trueを返す（Phase 1暫定実装）", async () => {
      const facility: FacilityRecommendation<RawNamedFacility> = {
        state: "unavailable",
        reason: "改札・出口の情報が確認できませんでした",
      };

      const result = await evaluateRetryGate(facility, { apiKey: "test_key" });
      expect(result.shouldRetry).toBe(true);
      expect(result.reason).toBe("No facility information available");
    });

    test("confirmed状態の場合、shouldRetry=falseを返す", async () => {
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
      expect(result.reason).toBe("Facility information present");
    });

    test("alternatives状態の場合、shouldRetry=falseを返す", async () => {
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
      expect(result.reason).toBe("Facility information present");
    });
  });
});
