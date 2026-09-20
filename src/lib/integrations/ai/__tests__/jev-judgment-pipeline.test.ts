import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FacilityPair } from "@/lib/domain/facility-recommendation";
import type { RawNamedFacility } from "../single-call-navigator";
import { runFacilityJudgmentPipeline, type JudgmentSnapshot } from "../jev-judgment-pipeline";

const mockEvaluateFacilityJudgment = vi.fn();

vi.mock("@/lib/integrations/ai/JevClient", () => ({
  evaluateFacilityJudgment: (...args: unknown[]) => mockEvaluateFacilityJudgment(...args),
}));

function raw(name: string): RawNamedFacility {
  return { name, confidenceLevel: "medium" };
}

function pair(
  gateName: string | null,
  exitName: string | null,
  reason: string | null = null
): FacilityPair<RawNamedFacility> {
  return {
    gate: gateName ? raw(gateName) : null,
    exit: exitName ? raw(exitName) : null,
    reason,
  };
}

function snapshot(
  overrides: Partial<JudgmentSnapshot<RawNamedFacility>> = {}
): JudgmentSnapshot<RawNamedFacility> {
  return {
    destinationHint: "ウエチャベ",
    arrivalStationName: "渋谷駅",
    searchText: "道玄坂改札 A1出口 ハチ公改札",
    geminiPairs: [],
    catalogPair: null,
    osmExitNames: [],
    ...overrides,
  };
}

const JEV_CONFIG = { apiKey: "test_key" };

describe("runFacilityJudgmentPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("カタログで改札と出口が揃いJEVがスキップ可ならGemini施設を使わずretryしない", async () => {
    mockEvaluateFacilityJudgment.mockResolvedValue({
      adoptCatalog: true,
      skipGeminiFacility: true,
      candidateScores: [],
      reason: "catalog both",
    });

    const catalogPair = pair("道玄坂改札", "A1出口", "収録");
    const result = await runFacilityJudgmentPipeline(
      snapshot({
        catalogPair,
        geminiPairs: [pair("ハチ公改札", "ハチ公口")],
      }),
      JEV_CONFIG
    );

    expect(result.skipGeminiFacility).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.bothHit).toBe(true);
    expect(result.recommendation).toEqual({
      state: "confirmed",
      pair: catalogPair,
    });
  });

  test("カタログBothHitでJEVが落ちても地名を捏造せずカタログを採用する（fail-open）", async () => {
    mockEvaluateFacilityJudgment.mockRejectedValue(new Error("JEV API error"));

    const catalogPair = pair("道玄坂改札", "A1出口");
    const result = await runFacilityJudgmentPipeline(
      snapshot({ catalogPair, geminiPairs: [] }),
      JEV_CONFIG
    );

    expect(result.skipGeminiFacility).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.bothHit).toBe(true);
    expect(result.recommendation.state).toBe("confirmed");
    if (result.recommendation.state === "confirmed") {
      expect(result.recommendation.pair.gate?.name).toBe("道玄坂改札");
      expect(result.recommendation.pair.exit?.name).toBe("A1出口");
    }
  });

  test("カタログBothHitでもJEVがGeminiを使うと言い、GeminiもBothHitならGeminiを採用する", async () => {
    mockEvaluateFacilityJudgment.mockResolvedValue({
      adoptCatalog: false,
      skipGeminiFacility: false,
      candidateScores: [0.9],
      reason: "use gemini",
    });

    const result = await runFacilityJudgmentPipeline(
      snapshot({
        catalogPair: pair("西改札", "西口"),
        geminiPairs: [pair("道玄坂改札", "A1出口")],
      }),
      JEV_CONFIG
    );

    expect(result.skipGeminiFacility).toBe(false);
    expect(result.bothHit).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.recommendation.state).toBe("confirmed");
    if (result.recommendation.state === "confirmed") {
      expect(result.recommendation.pair.gate?.name).toBe("道玄坂改札");
      expect(result.recommendation.pair.exit?.name).toBe("A1出口");
    }
  });

  test("カタログBothHitでJEVがGemini指定でもGeminiが片方だけならカタログを維持する", async () => {
    mockEvaluateFacilityJudgment.mockResolvedValue({
      adoptCatalog: false,
      skipGeminiFacility: false,
      candidateScores: [0.9],
      reason: "use gemini",
    });

    const catalogPair = pair("道玄坂改札", "A1出口");
    const result = await runFacilityJudgmentPipeline(
      snapshot({
        catalogPair,
        geminiPairs: [pair("ハチ公改札", null)],
      }),
      JEV_CONFIG
    );

    expect(result.skipGeminiFacility).toBe(true);
    expect(result.bothHit).toBe(true);
    expect(result.shouldRetry).toBe(false);
    if (result.recommendation.state === "confirmed") {
      expect(result.recommendation.pair.gate?.name).toBe("道玄坂改札");
      expect(result.recommendation.pair.exit?.name).toBe("A1出口");
    }
  });

  test("JEVが改札だけの組を好んでも、同じ抽出にBothHitがあればそちらを採用する", async () => {
    mockEvaluateFacilityJudgment.mockResolvedValue({
      adoptCatalog: false,
      skipGeminiFacility: false,
      candidateScores: [0.99, 0.1],
      reason: "prefer gate-only",
    });

    const result = await runFacilityJudgmentPipeline(
      snapshot({
        geminiPairs: [pair("ハチ公改札", null), pair("道玄坂改札", "A1出口")],
      }),
      JEV_CONFIG
    );

    expect(result.bothHit).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.recommendation).toEqual({
      state: "confirmed",
      pair: pair("道玄坂改札", "A1出口"),
    });
  });

  test("JEVスコアが全て0ならalternativesのままfail-openする", async () => {
    mockEvaluateFacilityJudgment.mockResolvedValue({
      adoptCatalog: false,
      skipGeminiFacility: false,
      candidateScores: [0, 0],
      reason: "empty scores",
    });

    const result = await runFacilityJudgmentPipeline(
      snapshot({
        geminiPairs: [pair("道玄坂改札", "A1出口"), pair("ハチ公改札", "ハチ公口")],
      }),
      JEV_CONFIG
    );

    expect(result.recommendation.state).toBe("alternatives");
    expect(result.bothHit).toBe(true);
    expect(result.shouldRetry).toBe(false);
  });

  test("Geminiの複数候補からJEVスコア最大を1組に絞る", async () => {
    mockEvaluateFacilityJudgment.mockResolvedValue({
      adoptCatalog: false,
      skipGeminiFacility: false,
      candidateScores: [0.2, 0.85],
      reason: "prefer 1",
    });

    const result = await runFacilityJudgmentPipeline(
      snapshot({
        geminiPairs: [pair("道玄坂改札", "A2出口"), pair("道玄坂改札", "A1出口")],
      }),
      JEV_CONFIG
    );

    expect(result.recommendation).toEqual({
      state: "confirmed",
      pair: pair("道玄坂改札", "A1出口"),
    });
    expect(result.bothHit).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.skipGeminiFacility).toBe(false);
  });

  test("改札だけのconfirmedをBothHit成功にもretry不要にもしない（Option A不採用）", async () => {
    mockEvaluateFacilityJudgment.mockResolvedValue({
      adoptCatalog: false,
      skipGeminiFacility: false,
      candidateScores: [0.99],
      reason: "small station one side is enough",
    });

    const result = await runFacilityJudgmentPipeline(
      snapshot({ geminiPairs: [pair("改札", null)] }),
      JEV_CONFIG
    );

    expect(result.bothHit).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.recommendation.state).toBe("confirmed");
    if (result.recommendation.state === "confirmed") {
      expect(result.recommendation.pair.exit).toBeNull();
    }
  });

  test("JEV未設定なら件数分類し、BothHitでなければretryする", async () => {
    const result = await runFacilityJudgmentPipeline(
      snapshot({ geminiPairs: [pair("道玄坂改札", null)] }),
      null
    );

    expect(mockEvaluateFacilityJudgment).not.toHaveBeenCalled();
    expect(result.bothHit).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.recommendation.state).toBe("confirmed");
  });

  test("JEVランキング失敗時は件数分類へfail-openし、名前は捏造しない", async () => {
    mockEvaluateFacilityJudgment.mockRejectedValue(new Error("timeout"));

    const result = await runFacilityJudgmentPipeline(
      snapshot({
        geminiPairs: [pair("道玄坂改札", "A1出口"), pair("ハチ公改札", "ハチ公口")],
      }),
      JEV_CONFIG
    );

    expect(result.recommendation.state).toBe("alternatives");
    expect(result.bothHit).toBe(true);
    expect(result.shouldRetry).toBe(false);
    if (result.recommendation.state === "alternatives") {
      expect(result.recommendation.pairs.map((p) => p.exit?.name)).toEqual(["A1出口", "ハチ公口"]);
    }
  });

  test("OSMにあるだけの出口名は候補に足さない（外部失敗・未収録は捏造しない）", async () => {
    mockEvaluateFacilityJudgment.mockResolvedValue({
      adoptCatalog: false,
      skipGeminiFacility: false,
      candidateScores: [0.8],
      reason: "ok",
    });

    const result = await runFacilityJudgmentPipeline(
      snapshot({
        geminiPairs: [pair("道玄坂改札", "A1出口")],
        osmExitNames: ["存在しない捏造口"],
      }),
      JEV_CONFIG
    );

    expect(result.recommendation.state).toBe("confirmed");
    if (result.recommendation.state === "confirmed") {
      expect(result.recommendation.pair.exit?.name).toBe("A1出口");
      expect(result.recommendation.pair.exit?.name).not.toBe("存在しない捏造口");
    }
  });
});
