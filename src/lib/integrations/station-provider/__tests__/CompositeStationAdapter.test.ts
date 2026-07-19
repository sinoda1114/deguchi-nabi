import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * KvCacheStore(@/lib/store/kv-cache-store の getKvCacheStore)のインメモリ・
 * フェイク。collection -> key -> { value, seq } の入れ子Mapで状態を持つ。
 * seq はJsonKvStore/TursoKvStoreのcreatedAtに相当する挿入順の代理指標
 * (Date.now()だと同一ミリ秒内の連続awaitで順序が不定になりうるため、
 * テストの決定性のためグローバルなカウンタを使う)。既存の
 * CompositeStationAdapter.test.tsが検証していた「LRU上限・レートリミッタ・
 * フォールバック・空はキャッシュしない」等の挙動は、モック対象を
 * json-file-store から kv-cache-store に差し替えても同じように検証できる
 * よう、このフェイクは KvCacheStore インターフェースを忠実に実装する。
 */
interface KvRow {
  value: unknown;
  seq: number;
}

let kvSequence = 0;
const kvState = new Map<string, Map<string, KvRow>>();

function collectionMap(collection: string): Map<string, KvRow> {
  let m = kvState.get(collection);
  if (!m) {
    m = new Map();
    kvState.set(collection, m);
  }
  return m;
}

function clearKvState(): void {
  kvState.clear();
  kvSequence = 0;
}

const kvStoreMock = {
  get: vi.fn(async (collection: string, key: string) => {
    const row = kvState.get(collection)?.get(key);
    if (!row) return null;
    return { value: row.value, verifiedAt: new Date(row.seq).toISOString(), expiresAt: null };
  }),
  set: vi.fn(async (collection: string, key: string, value: unknown) => {
    const m = collectionMap(collection);
    const existing = m.get(key);
    m.set(key, { value, seq: existing?.seq ?? kvSequence++ });
  }),
  deleteByKeyPrefix: vi.fn(async (collection: string, prefix: string) => {
    const m = kvState.get(collection);
    if (!m) return 0;
    let deleted = 0;
    for (const key of Array.from(m.keys())) {
      if (key.startsWith(prefix)) {
        m.delete(key);
        deleted++;
      }
    }
    return deleted;
  }),
  countByKeyPrefix: vi.fn(async (collection: string, prefix: string) => {
    const m = kvState.get(collection);
    if (!m) return 0;
    let count = 0;
    for (const key of m.keys()) if (key.startsWith(prefix)) count++;
    return count;
  }),
  deleteOldestByKeyPrefix: vi.fn(async (collection: string, prefix: string) => {
    const m = kvState.get(collection);
    if (!m) return;
    let oldestKey: string | null = null;
    let oldestSeq = Infinity;
    for (const [key, row] of m.entries()) {
      if (key.startsWith(prefix) && row.seq < oldestSeq) {
        oldestSeq = row.seq;
        oldestKey = key;
      }
    }
    if (oldestKey) m.delete(oldestKey);
  }),
};

vi.mock("@/lib/store/kv-cache-store", () => ({
  getKvCacheStore: () => kvStoreMock,
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
const fetchNearestStationsFromHeartRails = vi.fn(async (_lat: number, _lng: number) => null as unknown);
const decodeHeartRailsStationId = vi.fn((_stationId: string) => null as unknown);
vi.mock("../heartrails", () => ({
  fetchNearestStationsFromHeartRails: (lat: number, lng: number) =>
    fetchNearestStationsFromHeartRails(lat, lng),
  decodeHeartRailsStationId: (stationId: string) => decodeHeartRailsStationId(stationId),
  searchStationsFromHeartRails: (query: string) => searchStationsFromHeartRails(query),
}));

const { CompositeStationAdapter } = await import("../CompositeStationAdapter");

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

describe("CompositeStationAdapter.getBoardingPosition", () => {
  beforeEach(() => {
    clearKvState();
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
      "st_shinjuku::pf::pf_shinjuku_jr_yamanote",
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
      "st_unknown::line::テスト線::到着方面",
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
      "st_unknown::line::テスト線::到着方面",
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

  test("fixture platform経由の生成結果は`${stationId}::pf::${platformId}`キーでKvCacheStoreに保存される(キー設計の回帰確認)", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new CompositeStationAdapter("test-key");
    await adapter.getBoardingPosition(
      "st_shinjuku",
      "新宿駅",
      "pf_shinjuku_jr_yamanote",
      "JR山手線",
      "渋谷方面"
    );
    expect(kvStoreMock.set).toHaveBeenCalledWith(
      "ai-boarding-positions",
      "st_shinjuku::pf::pf_shinjuku_jr_yamanote",
      AI_POSITION,
      { ttlDays: 90 }
    );
  });

  test("line経由(fixture platform無し)の生成結果は`${stationId}::line::${line}::${direction}`キーでKvCacheStoreに保存される(キー設計の回帰確認)", async () => {
    generateBoardingPosition.mockResolvedValue(AI_POSITION);
    const adapter = new CompositeStationAdapter("test-key");
    await adapter.getBoardingPosition("st_unknown", "未知駅", "", "テスト線", "到着方面");
    expect(kvStoreMock.set).toHaveBeenCalledWith(
      "ai-boarding-positions",
      "st_unknown::line::テスト線::到着方面",
      AI_POSITION,
      { ttlDays: 90 }
    );
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
      "st_shibuya::line::相鉄新横浜線::渋谷方面",
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
      "st_shinjuku::pf::pf_shinjuku_jr_yamanote",
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
    const adapter = new CompositeStationAdapter("test-key");

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
    const adapter = new CompositeStationAdapter("test-key");

    const resolved = await adapter.getStation(NAGOYA.stationId);

    expect(resolved?.stationName).toBe("名古屋駅");
    expect(resolved?.lines).toEqual([]);
  });

  test("stationId自体が復元不能(decodeがnull)な場合はnullを返す(再照会もしない)", async () => {
    decodeHeartRailsStationId.mockReturnValue(null);
    const adapter = new CompositeStationAdapter("test-key");

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
    const adapter = new CompositeStationAdapter("test-key");

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
    const adapter = new CompositeStationAdapter("test-key");

    await adapter.getStation(NAGOYA.stationId);
    await adapter.getStation(SHIN_YOKOHAMA.stationId);

    expect(fetchNearestStationsFromHeartRails).toHaveBeenCalledTimes(2);
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
    clearKvState();
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
      { lat: 35.1, lng: 136.2 },
      null
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
    const adapter = new CompositeStationAdapter("test-key");
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

  test("destinationHint付きfacilitiesは`${stationId}::h::${encodeURIComponent(destinationHint)}`キーでKvCacheStoreに保存される(キー設計の回帰確認)", async () => {
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

    await adapter.getFacilities("hr_test", "テストカフェ");

    expect(kvStoreMock.set).toHaveBeenCalledWith(
      "ai-station-facilities",
      `hr_test::h::${encodeURIComponent("テストカフェ")}`,
      [{ ...AI_FACILITY, stationId: "hr_test" }],
      { ttlDays: 90 }
    );
  });

  test("destinationHint無しのfacilitiesはstationId単独キーでKvCacheStoreに保存される(キー設計の回帰確認)", async () => {
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

    expect(kvStoreMock.set).toHaveBeenCalledWith(
      "ai-station-facilities",
      "hr_test",
      [{ ...AI_FACILITY, stationId: "hr_test" }],
      { ttlDays: 90 }
    );
  });

  test("destinationHintが異なれば同じ駅でも別々にキャッシュされ、それぞれAIを1回ずつ呼ぶ(目的地ごとに改札・出口の推奨が変わりうるため)", async () => {
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

    await adapter.getFacilities("hr_test", "テストカフェA");
    await adapter.getFacilities("hr_test", "テストカフェB");

    expect(generateStationFacilities).toHaveBeenCalledTimes(2);
  });

  test("同じdestinationHintであれば再度AIを呼ばずキャッシュを使う", async () => {
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

    await adapter.getFacilities("hr_test", "テストカフェ");
    await adapter.getFacilities("hr_test", "テストカフェ");

    expect(generateStationFacilities).toHaveBeenCalledTimes(1);
  });

  test("destinationHint無し(駅目的地)のキャッシュと、destinationHint有り(施設目的地)のキャッシュは別物として扱われる", async () => {
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
    await adapter.getFacilities("hr_test", "テストカフェ");

    expect(generateStationFacilities).toHaveBeenCalledTimes(2);
  });

  test("同一駅へのdestinationHint付きキャッシュエントリ数には上限があり、古いものから削除される(/ai-review指摘、High: 未認証・レート制限なしのエンドポイントから同一駅に異なる実在施設名を指定し続けることでキャッシュを無制限に肥大化させ、課金対象のAI呼び出しを繰り返し誘発できてしまう懸念への緩和策)", async () => {
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

    // 上限(5件)を超える6件の異なるdestinationHintで新規生成させる。
    for (let i = 0; i < 6; i++) {
      await adapter.getFacilities("hr_test", `テスト施設${i}`);
    }

    // 上限を超えた分、最も古い(テスト施設0)は削除されているため、
    // 再度同じdestinationHintで問い合わせると再度AIが呼ばれる(キャッシュされていない)。
    generateStationFacilities.mockClear();
    await adapter.getFacilities("hr_test", "テスト施設0");
    expect(generateStationFacilities).toHaveBeenCalledTimes(1);

    // 直近の施設(テスト施設5)はまだキャッシュに残っているため、AIは呼ばれない。
    generateStationFacilities.mockClear();
    await adapter.getFacilities("hr_test", "テスト施設5");
    expect(generateStationFacilities).not.toHaveBeenCalled();
  });

  test("LRU上限のcountByKeyPrefix/deleteOldestByKeyPrefixは駅ごとのdestinationHint接頭辞(`${stationId}::h::`)で呼ばれる(キー設計の回帰確認)", async () => {
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

    for (let i = 0; i < 6; i++) {
      await adapter.getFacilities("hr_test", `テスト施設${i}`);
    }

    expect(kvStoreMock.countByKeyPrefix).toHaveBeenCalledWith(
      "ai-station-facilities",
      "hr_test::h::"
    );
    expect(kvStoreMock.deleteOldestByKeyPrefix).toHaveBeenCalledWith(
      "ai-station-facilities",
      "hr_test::h::"
    );
  });

  test("destinationHint無し(駅目的地)のキャッシュはdestinationHint付きエントリ数の上限の対象外", async () => {
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
    for (let i = 0; i < 6; i++) {
      await adapter.getFacilities("hr_test", `テスト施設${i}`);
    }

    generateStationFacilities.mockClear();
    await adapter.getFacilities("hr_test");
    expect(generateStationFacilities).not.toHaveBeenCalled();
  });

  test("destinationHint付きの新規生成が時間窓内で上限に達すると、以降はdestinationHintを無視して駅全体検索にフォールバックする(/security-review指摘: LRU上限は保存件数のみを制限し呼び出し頻度は制限していなかったため、簡易レート制限を追加)", async () => {
    vi.useFakeTimers();
    try {
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

      // 上限(10回)までは通常通りdestinationHintが使われる。
      for (let i = 0; i < 10; i++) {
        await adapter.getFacilities("hr_test", `施設${i}`);
      }
      expect(generateStationFacilities).toHaveBeenCalledTimes(10);

      // 11回目はレート制限に達しているため、destinationHintが無視され
      // (null扱いで)駅全体検索にフォールバックする。
      generateStationFacilities.mockClear();
      await adapter.getFacilities("hr_test", "施設11");
      expect(generateStationFacilities).toHaveBeenCalledWith(
        "test-key",
        "テスト駅",
        "テスト鉄道",
        ["テスト線"],
        { lat: 35.1, lng: 136.2 },
        null
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("フォールバック生成(destinationHintがnullに正規化された呼び出し)もレート制限のカウントに含まれる(/ai-review指摘、High: フォールバック生成をカウントしないと、レート制限到達後もdestinationHint付きで呼び続けるだけで無制限に新規AI呼び出しを発生させ続けられる。本番はIssue #59によりキャッシュ書き込みが常に失敗するため、フォールバック後のnullキャッシュも定着せずこの穴が現実的に顕在化する。ここではキャッシュを都度クリアしてその状況を模擬する)", async () => {
    vi.useFakeTimers();
    try {
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

      // t=0: 上限(10回)まで消費。
      for (let i = 0; i < 10; i++) {
        await adapter.getFacilities("hr_test", `施設${i}`);
      }

      // t=30秒: レート制限中に、異なる施設名で10回フォールバックさせる
      // (Issue #59模擬のため、facilitiesキャッシュのみ都度クリアして毎回
      // 新規生成にする。NEARBY_STATION_CACHEまで消すとgetStation自体が
      // 解決できなくなり生成に到達しないため、そちらは残す)。
      vi.advanceTimersByTime(30_000);
      for (let i = 10; i < 20; i++) {
        kvState.delete("ai-station-facilities");
        await adapter.getFacilities("hr_test", `施設${i}`);
      }

      // t=65秒: 最初の10回(t=0)は時間窓(60秒)外になるが、t=30の10回は
      // まだ時間窓内(35秒経過)。フォールバック生成がカウントされていれば、
      // まだレート制限中のままのはず。
      vi.advanceTimersByTime(35_000);
      kvState.delete("ai-station-facilities");
      generateStationFacilities.mockClear();
      await adapter.getFacilities("hr_test", "施設new");
      expect(generateStationFacilities).toHaveBeenCalledWith(
        "test-key",
        "テスト駅",
        "テスト鉄道",
        ["テスト線"],
        { lat: 35.1, lng: 136.2 },
        null
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("レート制限の時間窓が経過すれば、再度destinationHintが使えるようになる", async () => {
    vi.useFakeTimers();
    try {
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

      for (let i = 0; i < 10; i++) {
        await adapter.getFacilities("hr_test", `施設${i}`);
      }

      vi.advanceTimersByTime(60_001);

      generateStationFacilities.mockClear();
      await adapter.getFacilities("hr_test", "施設new");
      expect(generateStationFacilities).toHaveBeenCalledWith(
        "test-key",
        "テスト駅",
        "テスト鉄道",
        ["テスト線"],
        { lat: 35.1, lng: 136.2 },
        "施設new"
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CompositeStationAdapter.getArrivalGuideNarrativeSteps", () => {
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
