import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const storeState: Record<string, unknown[]> = {};

vi.mock("@/lib/store/json-file-store", () => ({
  readCollection: vi.fn((name: string) => storeState[name] ?? []),
  writeCollection: vi.fn((name: string, items: unknown[]) => {
    storeState[name] = items;
  }),
}));

const generateBoardingPosition = vi.fn();
const generateStationFacilities = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock("../ai-generation", async () => {
  // isPlainArrivalPlatformLabel は実実装をそのまま使う(CompositeStationAdapter側の
  // 分岐判定を正しく検証するため。generateBoardingPosition/generateStationFacilities
  // のみ実際のAI呼び出しをモックに差し替える)。
  const actual = await vi.importActual<typeof import("../ai-generation")>("../ai-generation");
  return {
    ...actual,
    generateBoardingPosition: (...args: unknown[]) => generateBoardingPosition(...args),
    generateStationFacilities: (...args: unknown[]) => generateStationFacilities(...args),
  };
});

const generateArrivalNarrativeSteps = vi.fn();
vi.mock("../arrival-guide-ai-generation", () => ({
  generateArrivalNarrativeSteps: (...args: unknown[]) => generateArrivalNarrativeSteps(...args),
}));

const searchStationsFromHeartRails = vi.fn(async (_query: string) => null as unknown);
vi.mock("../heartrails", () => ({
  fetchNearestStationsFromHeartRails: vi.fn(async () => null),
  decodeHeartRailsStationId: vi.fn(() => null),
  searchStationsFromHeartRails: (query: string) => searchStationsFromHeartRails(query),
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
    searchStationsFromHeartRails.mockReset().mockResolvedValue(null);
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
    // fixtureのplatformNumber("14")がAI生成の到着番線ヒントとして引き渡される。
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "新宿駅",
      "JR山手線",
      "渋谷方面",
      "pf_shinjuku_jr_yamanote",
      "14"
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
      "line__st_unknown__テスト線__到着方面",
      null
    );
  });

  test("AI生成ルート由来の到着番線ラベル(platformId)が渡された場合、号車推定へ引き渡す", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new CompositeStationAdapter("test-key");
    await adapter.getBoardingPosition("st_unknown", "未知駅", "3", "テスト線", "到着方面");
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "未知駅",
      "テスト線",
      "到着方面",
      "line__st_unknown__テスト線__到着方面",
      "3"
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
    // "pf_"接頭辞のfixture platformIdは、番線ラベルとして誤用しないためnullになる
    // (isPlainArrivalPlatformLabel参照。別駅のplatformIdをそのままAIプロンプトに
    // 混入させない)。
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "渋谷駅",
      "相鉄新横浜線",
      "渋谷方面",
      "line__st_shibuya__相鉄新横浜線__渋谷方面",
      null
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
      "pf_shinjuku_jr_yamanote",
      "14"
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

describe("CompositeStationAdapter.searchStations", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeState)) delete storeState[key];
    searchStationsFromHeartRails.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const NAGOYA: {
    stationId: string;
    stationName: string;
    operator: string;
    lines: string[];
    prefecture: string;
    latitude: number;
    longitude: number;
  } = {
    stationId: "hr_%E5%90%8D%E5%8F%A4%E5%B1%8B_136.8816_35.1707",
    stationName: "名古屋駅",
    operator: "",
    lines: ["JR東海道本線"],
    prefecture: "愛知県",
    latitude: 35.1707,
    longitude: 136.8816,
  };

  test("fixtureにヒットしない駅名でもHeartRailsで見つかれば結果に含める", async () => {
    searchStationsFromHeartRails.mockResolvedValue([NAGOYA]);
    const adapter = new CompositeStationAdapter("test-key");

    const result = await adapter.searchStations("名古屋");

    expect(result.some((s) => s.stationId === NAGOYA.stationId)).toBe(true);
  });

  test("HeartRailsの結果はgetStationで後から解決できるようキャッシュする", async () => {
    searchStationsFromHeartRails.mockResolvedValue([NAGOYA]);
    const adapter = new CompositeStationAdapter("test-key");

    await adapter.searchStations("名古屋");
    const resolved = await adapter.getStation(NAGOYA.stationId);

    expect(resolved?.stationName).toBe("名古屋駅");
  });

  test("HeartRailsが失敗(null)してもfixtureの検索結果は返す", async () => {
    searchStationsFromHeartRails.mockResolvedValue(null);
    const adapter = new CompositeStationAdapter("test-key");

    const result = await adapter.searchStations("西谷");

    expect(result.some((s) => s.stationId === "st_nishiya")).toBe(true);
  });

  test("fixtureとHeartRailsで同じstationIdが返っても重複しない", async () => {
    const nishiyaFromApi = {
      ...NAGOYA,
      stationId: "st_nishiya",
      stationName: "西谷駅",
    };
    searchStationsFromHeartRails.mockResolvedValue([nishiyaFromApi]);
    const adapter = new CompositeStationAdapter("test-key");

    const result = await adapter.searchStations("西谷");

    expect(result.filter((s) => s.stationId === "st_nishiya")).toHaveLength(1);
  });

  test("HeartRailsからの結果が上限を超えても件数制限する(短い部分一致クエリでの肥大化対策)", async () => {
    const manyStations = Array.from({ length: 50 }, (_, i) => ({
      ...NAGOYA,
      stationId: `hr_test_${i}`,
      stationName: `テスト駅${i}`,
    }));
    searchStationsFromHeartRails.mockResolvedValue(manyStations);
    const adapter = new CompositeStationAdapter("test-key");

    const result = await adapter.searchStations("テスト");

    expect(result.length).toBeLessThanOrEqual(20);
  });

  test("fixtureとHeartRailsを並列に問い合わせる(HeartRailsが遅くてもfixture検索を待たせない設計であることの回帰確認)", async () => {
    let resolveApi!: (v: unknown) => void;
    searchStationsFromHeartRails.mockReturnValue(
      new Promise((resolve) => {
        resolveApi = resolve;
      })
    );
    const adapter = new CompositeStationAdapter("test-key");

    const promise = adapter.searchStations("西谷");
    // fixture.searchStations は同期的な文字列比較のみで即完了するため、
    // HeartRails側が未解決の間でも呼び出し自体は既に行われているはず。
    expect(searchStationsFromHeartRails).toHaveBeenCalledWith("西谷");

    resolveApi(null);
    const result = await promise;
    expect(result.some((s) => s.stationId === "st_nishiya")).toBe(true);
  });
});

const AI_FACILITY = {
  facilityId: "fac_ai",
  stationId: "",
  facilityType: "gate" as const,
  name: "AI推定改札",
  level: "地上1階",
  accessible: false,
  coordinates: null,
  connectedGateId: null,
  confidence: {
    level: "medium" as const,
    reasons: ["AIによる推測情報(検索結果に基づく)。現地未確認のため参考程度に扱ってください。"],
    verifiedAt: null,
    expiresAt: null,
    sourceCount: 0,
  },
  verifiedAt: null,
  provenance: "ai_inferred" as const,
};

describe("CompositeStationAdapter.getFacilities", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeState)) delete storeState[key];
    generateStationFacilities.mockReset().mockResolvedValue([]);
    searchStationsFromHeartRails.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("fixtureにfacilitiesがあればそれを返し、AIは呼ばない", async () => {
    const adapter = new CompositeStationAdapter("test-key");
    const result = await adapter.getFacilities("st_shibuya");
    expect(result.length).toBeGreaterThan(0);
    expect(generateStationFacilities).not.toHaveBeenCalled();
  });

  test("fixtureに無い駅は、駅の座標を含めてAI生成にフォールバックする(同名駅の曖昧性解消のため)", async () => {
    generateStationFacilities.mockResolvedValue([AI_FACILITY]);
    searchStationsFromHeartRails.mockResolvedValue([
      {
        stationId: "hr_test",
        stationName: "テスト駅",
        operator: "テスト鉄道",
        lines: ["テスト線"],
        prefecture: "テスト県",
        latitude: 35.1,
        longitude: 136.2,
      },
    ]);
    const adapter = new CompositeStationAdapter("test-key");
    await adapter.searchStations("テスト");

    const result = await adapter.getFacilities("hr_test");

    expect(result).toHaveLength(1);
    expect(generateStationFacilities).toHaveBeenCalledWith(
      "test-key",
      "テスト駅",
      "テスト鉄道",
      ["テスト線"],
      { lat: 35.1, lng: 136.2 }
    );
  });

  test("生成結果はキャッシュされ、次回は再度AIを呼ばない", async () => {
    generateStationFacilities.mockResolvedValue([AI_FACILITY]);
    searchStationsFromHeartRails.mockResolvedValue([
      {
        stationId: "hr_test",
        stationName: "テスト駅",
        operator: "テスト鉄道",
        lines: ["テスト線"],
        prefecture: "テスト県",
        latitude: 35.1,
        longitude: 136.2,
      },
    ]);
    const adapter = new CompositeStationAdapter("test-key");
    await adapter.searchStations("テスト");

    await adapter.getFacilities("hr_test");
    await adapter.getFacilities("hr_test");

    expect(generateStationFacilities).toHaveBeenCalledTimes(1);
  });

  test("駅自体が解決できない場合は空配列を返す(AIは呼ばない)", async () => {
    const adapter = new CompositeStationAdapter("test-key");
    const result = await adapter.getFacilities("st_unknown_no_station");
    expect(result).toEqual([]);
    expect(generateStationFacilities).not.toHaveBeenCalled();
  });
});

describe("CompositeStationAdapter.getArrivalGuideNarrativeSteps", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeState)) delete storeState[key];
    generateArrivalNarrativeSteps.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const NARRATIVE_STEP = {
    type: "public_passage" as const,
    title: "地下通路",
    instruction: "地下通路を直進してください。",
    landmarks: [],
    confidence: {
      level: "medium" as const,
      reasons: ["AIによる推測情報(検索結果に基づく)。現地未確認のため参考程度に扱ってください。"],
      verifiedAt: null,
      expiresAt: null,
      sourceCount: 0,
    },
    provenance: "ai_inferred" as const,
  };

  test("生成結果をそのまま返す", async () => {
    generateArrivalNarrativeSteps.mockResolvedValue([NARRATIVE_STEP]);
    const adapter = new CompositeStationAdapter("test-key");

    const result = await adapter.getArrivalGuideNarrativeSteps(
      "st_shibuya",
      "渋谷駅",
      "ヒカリエ改札",
      "B5出口"
    );

    expect(result).toEqual([NARRATIVE_STEP]);
    expect(generateArrivalNarrativeSteps).toHaveBeenCalledWith(
      "test-key",
      "渋谷駅",
      "ヒカリエ改札",
      "B5出口",
      null
    );
  });

  test("座標を渡すとそのままAI生成関数へ引き継ぐ", async () => {
    generateArrivalNarrativeSteps.mockResolvedValue([NARRATIVE_STEP]);
    const adapter = new CompositeStationAdapter("test-key");

    await adapter.getArrivalGuideNarrativeSteps(
      "st_shibuya",
      "渋谷駅",
      "ヒカリエ改札",
      "B5出口",
      { lat: 35.6591, lng: 139.7038 }
    );

    expect(generateArrivalNarrativeSteps).toHaveBeenCalledWith(
      "test-key",
      "渋谷駅",
      "ヒカリエ改札",
      "B5出口",
      { lat: 35.6591, lng: 139.7038 }
    );
  });

  test("生成結果はキャッシュされ、同じ駅・改札・出口の組み合わせでは再度AIを呼ばない", async () => {
    generateArrivalNarrativeSteps.mockResolvedValue([NARRATIVE_STEP]);
    const adapter = new CompositeStationAdapter("test-key");

    await adapter.getArrivalGuideNarrativeSteps("st_shibuya", "渋谷駅", "ヒカリエ改札", "B5出口");
    const result = await adapter.getArrivalGuideNarrativeSteps(
      "st_shibuya",
      "渋谷駅",
      "ヒカリエ改札",
      "B5出口"
    );

    expect(result).toEqual([NARRATIVE_STEP]);
    expect(generateArrivalNarrativeSteps).toHaveBeenCalledTimes(1);
  });

  test("生成結果が空配列の場合はキャッシュしない(一時的なAPI障害を恒久的な情報なしとして固定しないため)", async () => {
    generateArrivalNarrativeSteps.mockResolvedValue([]);
    const adapter = new CompositeStationAdapter("test-key");

    await adapter.getArrivalGuideNarrativeSteps("st_shibuya", "渋谷駅", "ヒカリエ改札", "B5出口");
    await adapter.getArrivalGuideNarrativeSteps("st_shibuya", "渋谷駅", "ヒカリエ改札", "B5出口");

    expect(generateArrivalNarrativeSteps).toHaveBeenCalledTimes(2);
  });

  test("改札名・出口名の組み合わせが異なれば別キャッシュキーとして扱う", async () => {
    generateArrivalNarrativeSteps.mockResolvedValue([NARRATIVE_STEP]);
    const adapter = new CompositeStationAdapter("test-key");

    await adapter.getArrivalGuideNarrativeSteps("st_shibuya", "渋谷駅", "ヒカリエ改札", "B5出口");
    await adapter.getArrivalGuideNarrativeSteps("st_shibuya", "渋谷駅", "宮益坂改札", "宮益坂口");

    expect(generateArrivalNarrativeSteps).toHaveBeenCalledTimes(2);
  });
});
