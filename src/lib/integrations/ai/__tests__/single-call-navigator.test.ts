import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildNavigatorSearchPrompt,
  buildSharedGuideCacheKey,
  generateSingleCallNavigatorGuide,
  getSharedSingleCallNavigatorGuide,
} from "../single-call-navigator";
import type { Station } from "@/lib/domain/station";

const searchAndGenerateStructuredContentWithSearchText = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContentWithSearchText: (...args: unknown[]) =>
    searchAndGenerateStructuredContentWithSearchText(...args),
}));

const NISHIYA: Station = {
  stationId: "st_nishiya",
  stationName: "西谷駅",
  operator: "相模鉄道",
  lines: ["相鉄本線", "相鉄新横浜線"],
  prefecture: "神奈川県",
  latitude: 35.4696,
  longitude: 139.5679,
};

const SHIBUYA: Station = {
  stationId: "st_shibuya",
  stationName: "渋谷駅",
  operator: "東急電鉄",
  lines: ["東急東横線", "京王井の頭線"],
  prefecture: "東京都",
  latitude: 35.658,
  longitude: 139.7016,
};

// 抽出結果のgateName/exitNameは検索フェーズの生テキスト(searchText)への逐語
// 一致が必須(isVerbatimInSearchText)。このテストファイルでは、有効な候補と
// して扱いたい名称を必ずこのテキストに含める。
const VALID_SEARCH_TEXT = "詳細情報: 降りる改札は道玄坂改札、利用する出口はA1出口です。";

const VALID_RAW = {
  lines: ["相鉄・東急直通線"],
  transferCount: 0,
  estimatedMinutes: 35,
  facilityCandidates: [{ gateName: "道玄坂改札", exitName: "A1出口", confidence: "medium" }],
  boardingCarNumber: 5,
  boardingDoorPosition: "1番ドア",
  boardingReason: "階段が近いため",
  boardingConfidence: "low",
};

function mockResult(data: unknown, searchText: string = VALID_SEARCH_TEXT) {
  return { data, searchText };
}

describe("buildNavigatorSearchPrompt", () => {
  test("出発駅・目的地駅・目的地ヒントをプロンプトに含める", () => {
    const prompt = buildNavigatorSearchPrompt(NISHIYA, SHIBUYA, "しゃぶしゃぶ×居酒屋 ウエチャベ");
    expect(prompt).toContain("西谷駅");
    expect(prompt).toContain("渋谷駅");
    expect(prompt).toContain("しゃぶしゃぶ×居酒屋 ウエチャベ");
  });

  test("目的地ヒントが無い場合(目的地が駅そのもの)は駅名のみで組み立てる", () => {
    const prompt = buildNavigatorSearchPrompt(NISHIYA, SHIBUYA, null);
    expect(prompt).toContain("渋谷駅");
    expect(prompt).not.toContain("付近の「");
  });

  test("実在確認と適合性検証の分離・逆算手順・複数改札比較・確証条件を含める(改善プロンプトの骨子)", () => {
    const prompt = buildNavigatorSearchPrompt(NISHIYA, SHIBUYA, "ウエチャベ");
    expect(prompt).toContain("実在確認と適合性検証は別物");
    expect(prompt).toContain("目的地からの逆算");
    expect(prompt).toContain("複数改札がある駅での比較");
    expect(prompt).toContain("確証ありと判断するための条件");
  });
});

describe("generateSingleCallNavigatorGuide", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("正常な抽出結果からguideを組み立てる(改札・出口は1組のみ→confirmed)", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(mockResult(VALID_RAW));

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");

    expect(result).not.toBeNull();
    expect(result?.lines).toEqual(["相鉄・東急直通線"]);
    expect(result?.facility).toEqual({
      state: "confirmed",
      pair: {
        gate: { name: "道玄坂改札", confidenceLevel: "medium" },
        exit: { name: "A1出口", confidenceLevel: "medium" },
        reason: null,
      },
    });
    expect(result?.boarding).toEqual({
      carNumber: 5,
      doorPosition: "1番ドア",
      reason: "階段が近いため",
      confidenceLevel: "low",
    });
  });

  test("facilityCandidatesが2〜3件ならalternatives状態になる", async () => {
    const searchText =
      "利用する出口はみなみ西口(相鉄口)または5番街方面出口のいずれかです。改札は1階改札です。";
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult(
        {
          lines: ["相鉄本線"],
          transferCount: 0,
          estimatedMinutes: 10,
          facilityCandidates: [
            { gateName: "1階改札", exitName: "みなみ西口(相鉄口)", confidence: "medium" },
            { gateName: "1階改札", exitName: "5番街方面出口", confidence: "medium" },
          ],
        },
        searchText
      )
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.facility.state).toBe("alternatives");
    if (result?.facility.state === "alternatives") {
      expect(result.facility.pairs).toHaveLength(2);
      expect(result.facility.pairs.map((p) => p.exit?.name)).toEqual([
        "みなみ西口(相鉄口)",
        "5番街方面出口",
      ]);
    }
  });

  test("facilityCandidatesが4件以上ならunavailableに格下げされる(絞り込めていないとみなす)", async () => {
    const searchText = "候補A候補B候補C候補D";
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult(
        {
          lines: ["相鉄本線"],
          transferCount: 0,
          estimatedMinutes: 10,
          facilityCandidates: [
            { exitName: "候補A", confidence: "low" },
            { exitName: "候補B", confidence: "low" },
            { exitName: "候補C", confidence: "low" },
            { exitName: "候補D", confidence: "low" },
          ],
        },
        searchText
      )
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.facility.state).toBe("unavailable");
  });

  test("検索フェーズの生テキストに逐語で存在しない名称は棄却される(創作・補完の拒否)", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult(
        {
          lines: ["相鉄・東急直通線"],
          transferCount: 0,
          estimatedMinutes: 35,
          facilityCandidates: [{ gateName: "本文に存在しない改札名", confidence: "medium" }],
        },
        "本文には別の内容しか書かれていません。"
      )
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.facility.state).toBe("unavailable");
  });

  test("号車が未確認(boardingCarNumber省略)の場合、boardingはnullになる(断定を避ける挙動の維持)", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        lines: ["相鉄・東急直通線"],
        transferCount: 0,
        estimatedMinutes: 35,
        facilityCandidates: [{ gateName: "道玄坂改札", exitName: "A1出口", confidence: "medium" }],
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.boarding).toBeNull();
  });

  test("改札・出口が未確認(facilityCandidates省略)の場合はunavailableのまま(創作しない)", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        lines: ["相鉄・東急直通線"],
        transferCount: 0,
        estimatedMinutes: 35,
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.facility.state).toBe("unavailable");
  });

  test("改札名は明記されているがconfidenceだけ欠けている場合、棄却せずlowで採用する(本番再現バグの回帰テスト)", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult(
        {
          lines: ["相鉄本線"],
          transferCount: 0,
          estimatedMinutes: 13,
          facilityCandidates: [{ gateName: "1階改札（みなみ西口（相鉄口）側）" }],
        },
        "降りる改札は1階改札（みなみ西口（相鉄口）側）です。"
      )
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.facility).toEqual({
      state: "confirmed",
      pair: {
        gate: { name: "1階改札（みなみ西口（相鉄口）側）", confidenceLevel: "low" },
        exit: null,
        reason: null,
      },
    });
  });

  test("facilityCandidates自体が不正な型(配列でない)の場合はunavailableとして扱う", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        lines: ["相鉄・東急直通線"],
        transferCount: 0,
        estimatedMinutes: 35,
        facilityCandidates: "道玄坂改札",
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.facility.state).toBe("unavailable");
  });

  test("路線名に縮退生成の反復パターンが含まれる場合は無効として扱い、最終的にnullを返す", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        ...VALID_RAW,
        lines: ["瘉鉄改戳版最改版甘鉄改戳版最改版・瘉鉄改戳版最改版甘鉄改戳版最改版"],
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result).toBeNull();
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
  });

  test("改札名に異常に長い文字列が来た場合は採用しない(セキュリティ: 後段プロンプトへの汚染防止)", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        ...VALID_RAW,
        facilityCandidates: [
          { gateName: "あ".repeat(200), exitName: "A1出口", confidence: "medium" },
        ],
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.facility.state).toBe("confirmed");
    if (result?.facility.state === "confirmed") {
      expect(result.facility.pair.gate).toBeNull();
      expect(result.facility.pair.exit?.name).toBe("A1出口");
    }
  });

  test("号車が実在する編成両数の上限(16)を超える場合は採用しない(/ai-review指摘)", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        ...VALID_RAW,
        boardingCarNumber: 99,
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.boarding).toBeNull();
  });

  test("号車が上限(16)ちょうどの場合は採用する", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        ...VALID_RAW,
        boardingCarNumber: 16,
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.boarding?.carNumber).toBe(16);
  });

  test("1回目がnull・2回目が正常な場合、リトライして2回目の結果を返す", async () => {
    searchAndGenerateStructuredContentWithSearchText
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockResult(VALID_RAW));

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result).not.toBeNull();
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
  });

  test("2回ともnullの場合、最終的にnullを返し3回目は試行しない", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(null);

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result).toBeNull();
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
  });

  test("改札・出口の情報が両方とも確認できない(facility unavailable)場合も再試行する(本番実機で発覚した不具合の回帰テスト)", async () => {
    searchAndGenerateStructuredContentWithSearchText
      .mockResolvedValueOnce(
        mockResult({
          lines: ["相鉄本線"],
          transferCount: 0,
          estimatedMinutes: 13,
        })
      )
      .mockResolvedValueOnce(mockResult(VALID_RAW));

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
    expect(result?.facility).toEqual({
      state: "confirmed",
      pair: {
        gate: { name: "道玄坂改札", confidenceLevel: "medium" },
        exit: { name: "A1出口", confidenceLevel: "medium" },
        reason: null,
      },
    });
  });

  test("再試行しても改札・出口が両方未確認のままの場合、経路情報は捨てず直近の結果を返す", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        lines: ["相鉄本線"],
        transferCount: 0,
        estimatedMinutes: 13,
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result?.lines).toEqual(["相鉄本線"]);
    expect(result?.facility.state).toBe("unavailable");
  });

  test("1回目で正常な結果が返る場合、2回目(リトライ)は呼ばれない", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(mockResult(VALID_RAW));

    await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(1);
  });
});

describe("getSharedSingleCallNavigatorGuide", () => {
  test("同じキーで短時間内に呼ばれた場合、generatorは1回しか実行されない(2重課金防止)", async () => {
    const generator = vi.fn().mockResolvedValue(null);
    const key = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "ウエチャベ");

    await getSharedSingleCallNavigatorGuide(key, generator);
    await getSharedSingleCallNavigatorGuide(key, generator);

    expect(generator).toHaveBeenCalledTimes(1);
  });

  test("異なるキーでは別々にgeneratorが実行される", async () => {
    const generator = vi.fn().mockResolvedValue(null);
    const keyA = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "別のキー用ヒントA");
    const keyB = buildSharedGuideCacheKey("st_nishiya", "st_yokohama", "別のキー用ヒントB");

    await getSharedSingleCallNavigatorGuide(keyA, generator);
    await getSharedSingleCallNavigatorGuide(keyB, generator);

    expect(generator).toHaveBeenCalledTimes(2);
  });
});

describe("buildSharedGuideCacheKey", () => {
  test("目的地座標が異なる場合は別キーになる(/ai-review指摘: 同名施設の別店舗を混同しないため)", () => {
    const keyA = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "同名店舗", {
      lat: 35.1,
      lng: 139.1,
    });
    const keyB = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "同名店舗", {
      lat: 35.2,
      lng: 139.2,
    });
    expect(keyA).not.toBe(keyB);
  });

  test("目的地座標が同じ場合は同じキーになる", () => {
    const keyA = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "同名店舗", {
      lat: 35.1,
      lng: 139.1,
    });
    const keyB = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "同名店舗", {
      lat: 35.1,
      lng: 139.1,
    });
    expect(keyA).toBe(keyB);
  });
});
