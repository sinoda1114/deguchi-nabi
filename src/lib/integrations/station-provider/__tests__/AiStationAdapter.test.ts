import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * KvCacheStore(@/lib/store/kv-cache-store の getKvCacheStore)のインメモリ・
 * フェイク。nearby-stations(HeartRails検索結果のキャッシュ、AI生成ではない
 * ため撤去対象外)のget/setのみ検証に使う。facilities/boarding/arrival-guide
 * のAI生成結果は永続キャッシュしなくなったため(council議論2026-07-20)、
 * LRU・レート制限・SWR関連のフェイク実装は不要になり削除した。
 */
const kvState = new Map<string, Map<string, unknown>>();

function clearKvState(): void {
  kvState.clear();
}

const kvStoreMock = {
  get: vi.fn(async (collection: string, key: string) => {
    const value = kvState.get(collection)?.get(key);
    return value === undefined ? null : { value, verifiedAt: new Date().toISOString(), expiresAt: null };
  }),
  set: vi.fn(async (collection: string, key: string, value: unknown) => {
    if (!kvState.has(collection)) kvState.set(collection, new Map());
    kvState.get(collection)!.set(key, value);
  }),
};

vi.mock("@/lib/store/kv-cache-store", () => ({
  getKvCacheStore: () => kvStoreMock,
}));

const generateBoardingPosition = vi.fn();
const generateStationFacilities = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock("../ai-generation", async () => {
  // isPlainArrivalPlatformLabel は実実装をそのまま使う(AiStationAdapter側の
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

const generateSingleCallNavigatorGuide = vi.fn();
vi.mock("@/lib/integrations/ai/single-call-navigator", () => ({
  generateSingleCallNavigatorGuide: (...args: unknown[]) =>
    generateSingleCallNavigatorGuide(...args),
  buildSharedGuideCacheKey: (a: string, b: string, c: string | null) => `${a}::${b}::${c ?? ""}`,
  // テストではキャッシュ挙動自体を検証しないため、generatorを素通しするだけの
  // 単純な実装に差し替える(モジュール単位のキャッシュがテスト間で汚染しないようにする)。
  getSharedSingleCallNavigatorGuide: (_key: string, generator: () => Promise<unknown>) =>
    generator(),
}));

const searchStationsFromHeartRails = vi.fn(async (_query: string) => null as unknown);
const fetchNearestStationsFromHeartRails = vi.fn(async (_lat: number, _lng: number) => null as unknown);
const decodeHeartRailsStationId = vi.fn((_stationId: string) => null as unknown);
vi.mock("../heartrails", () => ({
  fetchNearestStationsFromHeartRails: (lat: number, lng: number) =>
    fetchNearestStationsFromHeartRails(lat, lng),
  decodeHeartRailsStationId: (stationId: string) => decodeHeartRailsStationId(stationId),
  searchStationsFromHeartRails: (query: string) => searchStationsFromHeartRails(query),
}));

const { AiStationAdapter } = await import("../AiStationAdapter");

const AI_POSITION = {
  boardingPositionId: "bp_ai",
  platformId: "st_unknown::line::テスト線::到着方面",
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

describe("AiStationAdapter.getBoardingPosition", () => {
  beforeEach(() => {
    clearKvState();
    generateBoardingPosition.mockReset();
    searchStationsFromHeartRails.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("platformIdが空文字でもstationId+line+directionでAI生成する", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new AiStationAdapter("test-key");
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
      "st_unknown::line::テスト線::到着方面",
      null
    );
  });

  test("AI生成ルート由来の到着番線ラベル(platformId)が渡された場合、号車推定へ引き渡す", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new AiStationAdapter("test-key");
    await adapter.getBoardingPosition("st_unknown", "未知駅", "3", "テスト線", "到着方面");
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "未知駅",
      "テスト線",
      "到着方面",
      "st_unknown::line::テスト線::到着方面",
      "3"
    );
  });

  test("'pf_'接頭辞のplatformId(旧fixture形式)は番線ラベルとして扱わない(誤って別データソースのIDが渡された場合の防御)", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new AiStationAdapter("test-key");
    const result = await adapter.getBoardingPosition(
      "st_shibuya",
      "渋谷駅",
      "pf_some_legacy_platform_id",
      "相鉄新横浜線",
      "渋谷方面"
    );
    expect(result?.carNumber).toBe(4);
    expect(generateBoardingPosition).toHaveBeenCalledWith(
      "test-key",
      "渋谷駅",
      "相鉄新横浜線",
      "渋谷方面",
      "st_shibuya::line::相鉄新横浜線::渋谷方面",
      null
    );
  });

  test("AI生成結果は毎回再生成される(永続キャッシュしない。council議論2026-07-20: 検索を伴うAI生成は実行ごとに表現が揺れうるため)", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new AiStationAdapter("test-key");
    await adapter.getBoardingPosition("st_unknown", "未知駅", "", "テスト線", "到着方面");
    const result = await adapter.getBoardingPosition(
      "st_unknown",
      "未知駅",
      "",
      "テスト線",
      "到着方面"
    );
    expect(result?.carNumber).toBe(4);
    expect(generateBoardingPosition).toHaveBeenCalledTimes(2);
    // ai-boarding-positionsコレクションへのKV読み書きが行われないことを直接検証する
    // (/ai-review指摘: 回数テストだけでは、将来「生成しつつ保存だけする」実装が
    // 復活しても検知できない)。
    expect(kvStoreMock.get).not.toHaveBeenCalledWith("ai-boarding-positions", expect.anything());
    expect(kvStoreMock.set).not.toHaveBeenCalledWith(
      "ai-boarding-positions",
      expect.anything(),
      expect.anything()
    );
  });

  test("AI生成が失敗(null)した場合は null を返す", async () => {
    generateBoardingPosition.mockResolvedValue(null);
    const adapter = new AiStationAdapter("test-key");
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

describe("AiStationAdapter.getPlatforms", () => {
  test("番線マスタ未実装のため常に空配列を返す", async () => {
    const adapter = new AiStationAdapter("test-key");
    const result = await adapter.getPlatforms("st_shibuya");
    expect(result).toEqual([]);
  });
});

describe("AiStationAdapter.searchStations", () => {
  beforeEach(() => {
    clearKvState();
    searchStationsFromHeartRails.mockReset();
    fetchNearestStationsFromHeartRails.mockReset().mockResolvedValue(null);
    decodeHeartRailsStationId.mockReset().mockReturnValue(null);
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

  test("HeartRailsで見つかった駅を結果に含める", async () => {
    searchStationsFromHeartRails.mockResolvedValue([NAGOYA]);
    const adapter = new AiStationAdapter("test-key");

    const result = await adapter.searchStations("名古屋");

    expect(result.some((s) => s.stationId === NAGOYA.stationId)).toBe(true);
  });

  test("HeartRailsの結果はgetStationで後から解決できるようキャッシュする", async () => {
    searchStationsFromHeartRails.mockResolvedValue([NAGOYA]);
    const adapter = new AiStationAdapter("test-key");

    await adapter.searchStations("名古屋");
    const resolved = await adapter.getStation(NAGOYA.stationId);

    expect(resolved?.stationName).toBe("名古屋駅");
  });

  test("HeartRailsが失敗(null)した場合は空配列を返す", async () => {
    searchStationsFromHeartRails.mockResolvedValue(null);
    const adapter = new AiStationAdapter("test-key");

    const result = await adapter.searchStations("西谷");

    expect(result).toEqual([]);
  });

  test("nearby-stationsキャッシュが効かない場合(本番の読み取り専用ファイルシステム等)、HeartRailsへ再照会してlinesを復元する", async () => {
    const decodedWithoutLines = {
      stationId: NAGOYA.stationId,
      stationName: "名古屋駅",
      operator: "",
      lines: [],
      prefecture: "",
      latitude: NAGOYA.latitude,
      longitude: NAGOYA.longitude,
    };
    decodeHeartRailsStationId.mockReturnValue(decodedWithoutLines);
    fetchNearestStationsFromHeartRails.mockResolvedValue([NAGOYA]);
    const adapter = new AiStationAdapter("test-key");

    // searchStations を経由せず、getStation単体呼び出し(cacheミス)を再現する。
    const resolved = await adapter.getStation(NAGOYA.stationId);

    expect(resolved?.lines).toEqual(["JR東海道本線"]);
    expect(fetchNearestStationsFromHeartRails).toHaveBeenCalledWith(
      NAGOYA.latitude,
      NAGOYA.longitude
    );
  });

  test("再照会でも該当駅が見つからない場合はdecode結果(lines空)にフォールバックする(クラッシュしない)", async () => {
    const decodedWithoutLines = {
      stationId: NAGOYA.stationId,
      stationName: "名古屋駅",
      operator: "",
      lines: [],
      prefecture: "",
      latitude: NAGOYA.latitude,
      longitude: NAGOYA.longitude,
    };
    decodeHeartRailsStationId.mockReturnValue(decodedWithoutLines);
    fetchNearestStationsFromHeartRails.mockResolvedValue(null);
    const adapter = new AiStationAdapter("test-key");

    const resolved = await adapter.getStation(NAGOYA.stationId);

    expect(resolved?.stationName).toBe("名古屋駅");
    expect(resolved?.lines).toEqual([]);
  });

  test("stationId自体が復元不能(decodeがnull)な場合はnullを返す(再照会もしない)", async () => {
    decodeHeartRailsStationId.mockReturnValue(null);
    const adapter = new AiStationAdapter("test-key");

    const resolved = await adapter.getStation("invalid_station_id");

    expect(resolved).toBeNull();
    expect(fetchNearestStationsFromHeartRails).not.toHaveBeenCalled();
  });

  test("同一stationIdへの複数回のgetStation呼び出しはHeartRailsへの再照会を1回に抑える(メモ化、区間数分の重複呼び出し防止)", async () => {
    const decodedWithoutLines = {
      stationId: NAGOYA.stationId,
      stationName: "名古屋駅",
      operator: "",
      lines: [],
      prefecture: "",
      latitude: NAGOYA.latitude,
      longitude: NAGOYA.longitude,
    };
    decodeHeartRailsStationId.mockReturnValue(decodedWithoutLines);
    fetchNearestStationsFromHeartRails.mockResolvedValue([NAGOYA]);
    const adapter = new AiStationAdapter("test-key");

    await adapter.getStation(NAGOYA.stationId);
    await adapter.getStation(NAGOYA.stationId);
    const [first, second] = await Promise.all([
      adapter.getStation(NAGOYA.stationId),
      adapter.getStation(NAGOYA.stationId),
    ]);

    expect(fetchNearestStationsFromHeartRails).toHaveBeenCalledTimes(1);
    expect(first?.lines).toEqual(["JR東海道本線"]);
    expect(second?.lines).toEqual(["JR東海道本線"]);
  });

  test("異なるstationIdはそれぞれ独立して再照会する(メモ化がstationId単位であることの確認)", async () => {
    const SHIN_YOKOHAMA = { ...NAGOYA, stationId: "hr_test_shin_yokohama", lines: ["東海道新幹線"] };
    decodeHeartRailsStationId.mockImplementation((stationId: string) => ({
      stationId,
      stationName: "テスト駅",
      operator: "",
      lines: [],
      prefecture: "",
      latitude: NAGOYA.latitude,
      longitude: NAGOYA.longitude,
    }));
    fetchNearestStationsFromHeartRails.mockResolvedValue([NAGOYA, SHIN_YOKOHAMA]);
    const adapter = new AiStationAdapter("test-key");

    await adapter.getStation(NAGOYA.stationId);
    await adapter.getStation(SHIN_YOKOHAMA.stationId);

    expect(fetchNearestStationsFromHeartRails).toHaveBeenCalledTimes(2);
  });

  test("HeartRailsからの結果が上限を超えても件数制限する(短い部分一致クエリでの肥大化対策)", async () => {
    const manyStations = Array.from({ length: 50 }, (_, i) => ({
      ...NAGOYA,
      stationId: `hr_test_${i}`,
      stationName: `テスト駅${i}`,
    }));
    searchStationsFromHeartRails.mockResolvedValue(manyStations);
    const adapter = new AiStationAdapter("test-key");

    const result = await adapter.searchStations("テスト");

    expect(result.length).toBeLessThanOrEqual(20);
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

describe("AiStationAdapter.getFacilities", () => {
  beforeEach(() => {
    clearKvState();
    generateStationFacilities.mockReset().mockResolvedValue([]);
    searchStationsFromHeartRails.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("駅の座標を含めてAI生成する(同名駅の曖昧性解消のため)", async () => {
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
    const adapter = new AiStationAdapter("test-key");
    await adapter.searchStations("テスト");

    const result = await adapter.getFacilities("hr_test");

    expect(result).toHaveLength(1);
    expect(generateStationFacilities).toHaveBeenCalledWith(
      "test-key",
      "テスト駅",
      "テスト鉄道",
      ["テスト線"],
      { lat: 35.1, lng: 136.2 },
      null
    );
  });

  test("駅自体が解決できない場合は空配列を返す(AIは呼ばない)", async () => {
    const adapter = new AiStationAdapter("test-key");
    const result = await adapter.getFacilities("st_unknown_no_station");
    expect(result).toEqual([]);
    expect(generateStationFacilities).not.toHaveBeenCalled();
  });

  test("destinationHint(目的地施設名)を渡すとgenerateStationFacilitiesへそのまま伝播する", async () => {
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
    const adapter = new AiStationAdapter("test-key");
    await adapter.searchStations("テスト");

    await adapter.getFacilities("hr_test", "テストカフェ");

    expect(generateStationFacilities).toHaveBeenCalledWith(
      "test-key",
      "テスト駅",
      "テスト鉄道",
      ["テスト線"],
      { lat: 35.1, lng: 136.2 },
      "テストカフェ"
    );
  });

  test("同じdestinationHintで複数回呼んでも永続キャッシュせず毎回AIを呼ぶ(council議論2026-07-20: 号車・改札名の表現が実行ごとに揺れうるAI生成をTTLキャッシュで固定する設計をやめ、毎回アドホックに生成する方針へ変更。IPレートリミット(PR4)が濫用対策を別途担う)", async () => {
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
    const adapter = new AiStationAdapter("test-key");
    await adapter.searchStations("テスト");

    await adapter.getFacilities("hr_test", "テストカフェ");
    await adapter.getFacilities("hr_test", "テストカフェ");
    await adapter.getFacilities("hr_test");

    expect(generateStationFacilities).toHaveBeenCalledTimes(3);
    // ai-station-facilitiesコレクションへのKV読み書きが行われないことを直接検証する
    // (searchStations経由のnearby-stationsコレクションへの書き込みは対象外。/ai-review指摘)。
    expect(kvStoreMock.get).not.toHaveBeenCalledWith("ai-station-facilities", expect.anything());
    expect(kvStoreMock.set).not.toHaveBeenCalledWith(
      "ai-station-facilities",
      expect.anything(),
      expect.anything()
    );
  });
});

describe("AiStationAdapter.getArrivalGuideNarrativeSteps", () => {
  beforeEach(() => {
    clearKvState();
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
    const adapter = new AiStationAdapter("test-key");

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
    const adapter = new AiStationAdapter("test-key");

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

  test("同じ駅・改札・出口の組み合わせで複数回呼んでも永続キャッシュせず毎回AIを呼ぶ(council議論2026-07-20)", async () => {
    generateArrivalNarrativeSteps.mockResolvedValue([NARRATIVE_STEP]);
    const adapter = new AiStationAdapter("test-key");

    await adapter.getArrivalGuideNarrativeSteps("st_shibuya", "渋谷駅", "ヒカリエ改札", "B5出口");
    const result = await adapter.getArrivalGuideNarrativeSteps(
      "st_shibuya",
      "渋谷駅",
      "ヒカリエ改札",
      "B5出口"
    );

    expect(result).toEqual([NARRATIVE_STEP]);
    expect(generateArrivalNarrativeSteps).toHaveBeenCalledTimes(2);
    // ai-arrival-guide-stepsコレクションへのKV読み書きが行われないことを直接検証する
    // (/ai-review指摘)。
    expect(kvStoreMock.get).not.toHaveBeenCalledWith("ai-arrival-guide-steps", expect.anything());
    expect(kvStoreMock.set).not.toHaveBeenCalledWith(
      "ai-arrival-guide-steps",
      expect.anything(),
      expect.anything()
    );
  });
});


describe("AiStationAdapter.getUnifiedArrivalGuide", () => {
  beforeEach(() => {
    generateSingleCallNavigatorGuide.mockReset();
    decodeHeartRailsStationId.mockReset();
    decodeHeartRailsStationId.mockReturnValue(null);
    fetchNearestStationsFromHeartRails.mockReset();
    fetchNearestStationsFromHeartRails.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const ORIGIN_DECODED = {
    stationId: "st_nishiya",
    stationName: "西谷駅",
    operator: "",
    lines: [],
    prefecture: "神奈川県",
    latitude: 35.4696,
    longitude: 139.5679,
  };

  test("originStationIdが解決できる場合、出発駅の完全なStationと到着駅のStationを組み立てて生成関数へ渡す", async () => {
    decodeHeartRailsStationId.mockReturnValue(ORIGIN_DECODED);
    generateSingleCallNavigatorGuide.mockResolvedValue({
      lines: ["相鉄本線"],
      transferCount: 0,
      estimatedMinutes: 10,
      arrivalPlatformNumber: null,
      boarding: null,
      gate: { name: "1F改札", confidenceLevel: "medium" },
      exit: { name: "五番街口", confidenceLevel: "medium" },
    });
    const adapter = new AiStationAdapter("test-key");

    await adapter.getUnifiedArrivalGuide(
      "st_yokohama",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "kawara CAFE&DINING 横浜店",
      { lat: 35.4662, lng: 139.6227 },
      { lat: 35.4657, lng: 139.622 },
      "st_nishiya"
    );

    expect(generateSingleCallNavigatorGuide).toHaveBeenCalledWith(
      "test-key",
      ORIGIN_DECODED,
      {
        stationId: "st_yokohama",
        stationName: "横浜駅",
        operator: "相鉄",
        lines: ["相鉄本線"],
        prefecture: "",
        latitude: 35.4662,
        longitude: 139.6227,
      },
      "kawara CAFE&DINING 横浜店",
      { lat: 35.4657, lng: 139.622 }
    );
  });

  test("originStationIdが渡されない場合、出発駅名のみの簡易Stationで生成関数を呼ぶ(フォールバック)", async () => {
    generateSingleCallNavigatorGuide.mockResolvedValue({
      lines: ["相鉄本線"],
      transferCount: 0,
      estimatedMinutes: 10,
      arrivalPlatformNumber: null,
      boarding: null,
      gate: null,
      exit: null,
    });
    const adapter = new AiStationAdapter("test-key");

    await adapter.getUnifiedArrivalGuide(
      "st_yokohama",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      null,
      null,
      null
    );

    const [, originArg] = generateSingleCallNavigatorGuide.mock.calls[0];
    expect(originArg).toEqual({
      stationId: "",
      stationName: "西谷駅",
      operator: "",
      lines: [],
      prefecture: "",
      latitude: 0,
      longitude: 0,
    });
  });

  test("到着駅の座標が無い場合、緯度経度0でフォールバックする", async () => {
    generateSingleCallNavigatorGuide.mockResolvedValue({
      lines: ["相鉄本線"],
      transferCount: 0,
      estimatedMinutes: 10,
      arrivalPlatformNumber: null,
      boarding: null,
      gate: null,
      exit: null,
    });
    const adapter = new AiStationAdapter("test-key");

    await adapter.getUnifiedArrivalGuide(
      "st_yokohama",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      null,
      null,
      null
    );

    const [, , destinationArg] = generateSingleCallNavigatorGuide.mock.calls[0];
    expect(destinationArg.latitude).toBe(0);
    expect(destinationArg.longitude).toBe(0);
  });

  test("boardingPositionのconfidenceLevelをai_inferredの上限(medium)にキャップしたConfidenceへ変換する", async () => {
    generateSingleCallNavigatorGuide.mockResolvedValue({
      lines: ["相鉄本線"],
      transferCount: 0,
      estimatedMinutes: 10,
      arrivalPlatformNumber: null,
      boarding: {
        carNumber: 6,
        doorPosition: "後方",
        reason: "1階改札への階段に近いため",
        confidenceLevel: "high",
      },
      gate: { name: "1F改札", confidenceLevel: "high" },
      exit: { name: "五番街口", confidenceLevel: "high" },
    });
    const adapter = new AiStationAdapter("test-key");

    const result = await adapter.getUnifiedArrivalGuide(
      "st_yokohama",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      null,
      null,
      null
    );

    expect(result?.boardingPosition?.carNumber).toBe(6);
    expect(result?.boardingPosition?.doorPosition).toBe("後方");
    expect(result?.boardingPosition?.confidence.level).toBe("medium");
    expect(result?.gate?.name).toBe("1F改札");
    expect(result?.gate?.confidence.level).toBe("medium");
    expect(result?.exit?.name).toBe("五番街口");
    expect(result?.exit?.confidence.level).toBe("medium");
  });

  test("boardingPositionがnullの場合はそのままnullとして返す", async () => {
    generateSingleCallNavigatorGuide.mockResolvedValue({
      lines: ["相鉄本線"],
      transferCount: 0,
      estimatedMinutes: 10,
      arrivalPlatformNumber: null,
      boarding: null,
      gate: { name: "1F改札", confidenceLevel: "medium" },
      exit: { name: "五番街口", confidenceLevel: "medium" },
    });
    const adapter = new AiStationAdapter("test-key");

    const result = await adapter.getUnifiedArrivalGuide(
      "st_yokohama",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      null,
      null,
      null
    );

    expect(result?.boardingPosition).toBeNull();
  });

  test("walkingStepsは常に空配列を返す(2026-07-21ユーザー判断: 出口から先の徒歩ナラティブは生成しない。実機で「右折」が実際は左折だった誤りが発覚したため)", async () => {
    generateSingleCallNavigatorGuide.mockResolvedValue({
      lines: ["相鉄本線"],
      transferCount: 0,
      estimatedMinutes: 10,
      arrivalPlatformNumber: null,
      boarding: null,
      gate: null,
      exit: null,
    });
    const adapter = new AiStationAdapter("test-key");

    const result = await adapter.getUnifiedArrivalGuide(
      "st_yokohama",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      null,
      null,
      null
    );

    expect(result?.walkingSteps).toEqual([]);
  });

  test("生成に失敗(null)した場合はnullを返す", async () => {
    generateSingleCallNavigatorGuide.mockResolvedValue(null);
    const adapter = new AiStationAdapter("test-key");

    const result = await adapter.getUnifiedArrivalGuide(
      "st_yokohama",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      null,
      null,
      null
    );

    expect(result).toBeNull();
  });
});
