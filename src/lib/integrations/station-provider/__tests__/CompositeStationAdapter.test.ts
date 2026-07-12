import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const storeState: Record<string, unknown[]> = {};

vi.mock("@/lib/store/json-file-store", () => ({
  readCollection: vi.fn((name: string) => storeState[name] ?? []),
  writeCollection: vi.fn((name: string, items: unknown[]) => {
    storeState[name] = items;
  }),
}));

const generateBoardingPosition = vi.fn();
vi.mock("../ai-generation", () => ({
  generateBoardingPosition: (...args: unknown[]) => generateBoardingPosition(...args),
  generateStationFacilities: vi.fn(async () => []),
}));

vi.mock("../heartrails", () => ({
  fetchNearestStationsFromHeartRails: vi.fn(async () => null),
  decodeHeartRailsStationId: vi.fn(() => null),
}));

const { CompositeStationAdapter } = await import("../CompositeStationAdapter");

const AI_POSITION = {
  boardingPositionId: "bp_ai",
  platformId: "line__st_unknown__テスト線__到着方面",
  trainFormation: 0,
  carNumber: 4,
  doorPosition: "前方" as const,
  targetFacilityId: null,
  reason: "AIによる推測情報。現地未確認のため参考程度に扱ってください。",
  confidence: {
    level: "low" as const,
    reasons: ["AIによる推測情報。現地未確認のため参考程度に扱ってください。"],
    verifiedAt: null,
    expiresAt: null,
    sourceCount: 0,
  },
  verifiedAt: null,
};

describe("CompositeStationAdapter.getBoardingPosition", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeState)) delete storeState[key];
    generateBoardingPosition.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("fixture platform に fixture 号車データがあればそれを返し、AIは呼ばない", async () => {
    const adapter = new CompositeStationAdapter("test-key");
    const result = await adapter.getBoardingPosition(
      "st_nishiya",
      "西谷駅",
      "pf_nishiya_soutetsu_shin_yokohama",
      "相鉄新横浜線",
      "渋谷方面"
    );
    expect(result?.carNumber).toBe(8);
    expect(generateBoardingPosition).not.toHaveBeenCalled();
  });

  test("fixture platform はあるが号車データが無ければAIにフォールバックする(新宿→渋谷相当)", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new CompositeStationAdapter("test-key");
    const result = await adapter.getBoardingPosition(
      "st_shinjuku",
      "新宿駅",
      "pf_shinjuku_jr_yamanote",
      "JR山手線",
      "渋谷方面"
    );
    expect(result?.carNumber).toBe(4);
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "新宿駅",
      "JR山手線",
      "渋谷方面",
      "pf_shinjuku_jr_yamanote"
    );
  });

  test("fixture platformが存在しない(fixture未収録駅を含むAI生成ルート)場合もplatformIdに依存せずAIにフォールバックする", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new CompositeStationAdapter("test-key");
    const result = await adapter.getBoardingPosition(
      "st_unknown",
      "未知駅",
      "",
      "テスト線",
      "到着方面"
    );
    expect(result?.carNumber).toBe(4);
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "未知駅",
      "テスト線",
      "到着方面",
      "line__st_unknown__テスト線__到着方面"
    );
  });

  test("AI生成結果はキャッシュされ、次回は再度AIを呼ばない", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new CompositeStationAdapter("test-key");
    await adapter.getBoardingPosition("st_unknown", "未知駅", "", "テスト線", "到着方面");
    const result = await adapter.getBoardingPosition(
      "st_unknown",
      "未知駅",
      "",
      "テスト線",
      "到着方面"
    );
    expect(result?.carNumber).toBe(4);
    expect(generateBoardingPosition).toHaveBeenCalledTimes(1);
  });

  test("platformIdが別駅のものと一致してしまっても、その駅の号車情報は使わずAIにフォールバックする", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new CompositeStationAdapter("test-key");
    // pf_nishiya_soutetsu_shin_yokohama は st_nishiya 所属だが、st_shibuya として渡す
    const result = await adapter.getBoardingPosition(
      "st_shibuya",
      "渋谷駅",
      "pf_nishiya_soutetsu_shin_yokohama",
      "相鉄新横浜線",
      "渋谷方面"
    );
    expect(result?.carNumber).toBe(4);
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "渋谷駅",
      "相鉄新横浜線",
      "渋谷方面",
      "line__st_shibuya__相鉄新横浜線__渋谷方面"
    );
  });

  test("fixture platformに一致した場合、呼び出し元のline/directionが不整合でもfixture側の正規値でAI生成する", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new CompositeStationAdapter("test-key");
    await adapter.getBoardingPosition(
      "st_shinjuku",
      "新宿駅",
      "pf_shinjuku_jr_yamanote",
      "誤った路線名",
      "誤った方面"
    );
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "新宿駅",
      "JR山手線",
      "渋谷方面",
      "pf_shinjuku_jr_yamanote"
    );
  });

  test("AI生成が失敗(null)した場合は null を返す", async () => {
    generateBoardingPosition.mockResolvedValue(null);
    const adapter = new CompositeStationAdapter("test-key");
    const result = await adapter.getBoardingPosition(
      "st_unknown",
      "未知駅",
      "",
      "テスト線",
      "到着方面"
    );
    expect(result).toBeNull();
  });
});
