import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildNavigatorSearchPrompt,
  buildSharedGuideCacheKey,
  generateSingleCallNavigatorGuide,
  getSharedSingleCallNavigatorGuide,
  isRouteConsistent,
  selectFinalGuide,
  type SingleCallNavigatorGuide,
  type RawFacilityRecommendation,
} from "../single-call-navigator";
import type { Station } from "@/lib/domain/station";
import type { ConfidenceLevel } from "@/lib/domain/confidence";

const searchAndGenerateStructuredContentWithSearchText = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContentWithSearchText: (...args: unknown[]) =>
    searchAndGenerateStructuredContentWithSearchText(...args),
}));

// JevClientのモック
const mockEvaluateRetryGate = vi.fn();
const mockEvaluateFacilityCompleteness = vi.fn();
const mockEvaluateRouteConsistency = vi.fn();
const mockIsJevAvailable = vi.fn();
const mockCreateJevConfig = vi.fn();
vi.mock("@/lib/integrations/ai/JevClient", () => ({
  evaluateRetryGate: (...args: unknown[]) => mockEvaluateRetryGate(...args),
  evaluateFacilityCompleteness: (...args: unknown[]) => mockEvaluateFacilityCompleteness(...args),
  evaluateRouteConsistency: (...args: unknown[]) => mockEvaluateRouteConsistency(...args),
  isJevAvailable: () => mockIsJevAvailable(),
  createJevConfig: () => mockCreateJevConfig(),
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
    // JEVモックをリセット
    mockIsJevAvailable.mockReturnValue(false);
    mockCreateJevConfig.mockReturnValue(null);
    mockEvaluateRetryGate.mockResolvedValue({ shouldRetry: false });
    mockEvaluateFacilityCompleteness.mockResolvedValue({
      isComplete: true,
      missingFields: [],
      shouldRetry: false,
    });
    mockEvaluateRouteConsistency.mockResolvedValue({
      isConsistent: true,
      reason: "JEV判定: 同一ルート（確信度: 0.95）",
    });
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
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(3);
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

  test("3回ともnullの場合、最終的にnullを返す", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(null);

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result).toBeNull();
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(3);
  });

  test("改札・出口の情報が両方とも確認できない(facility unavailable)場合も再試行する。経路一致なら2回目を採用", async () => {
    const CONSISTENT_RAW = { ...VALID_RAW, lines: ["相鉄本線"] }; // 経路を統一
    searchAndGenerateStructuredContentWithSearchText
      .mockResolvedValueOnce(
        mockResult({
          lines: ["相鉄本線"],
          transferCount: 0,
          estimatedMinutes: 13,
        })
      )
      .mockResolvedValueOnce(mockResult(CONSISTENT_RAW));

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

  test("3回試行しても改札・出口が両方未確認のままの場合、経路情報は捨てず直近の結果を返す", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        lines: ["相鉄本線"],
        transferCount: 0,
        estimatedMinutes: 13,
      })
    );

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(3);
    expect(result).not.toBeNull();
    expect(result?.lines).toEqual(["相鉄本線"]);
    expect(result?.facility.state).toBe("unavailable");
  });

  test("1回目で正常な結果が返る場合、2回目(リトライ)は呼ばれない", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(mockResult(VALID_RAW));

    await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(1);
  });

  describe("JEV統合（Phase 1: retry gate判定）", () => {
    test("JEV_API_KEYが設定されていない場合、従来のルールベース判定を使用する", async () => {
      mockIsJevAvailable.mockReturnValue(false);
      const CONSISTENT_VALID_RAW = { ...VALID_RAW, lines: ["相鉄本線"] }; // 経路を統一
      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult({
            lines: ["相鉄本線"],
            transferCount: 0,
            estimatedMinutes: 13,
          })
        )
        .mockResolvedValueOnce(
          mockResult({
            lines: ["相鉄本線"],
            transferCount: 0,
            estimatedMinutes: 13,
          })
        )
        .mockResolvedValueOnce(mockResult(CONSISTENT_VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
      
      // unavailableなのでretryされる（従来挙動）、3回目で成功
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(3);
      expect(mockEvaluateRetryGate).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
    });

    test("JEV_API_KEYが設定されている場合、JEVによる判定を使用する", async () => {
      mockIsJevAvailable.mockReturnValue(true);
      mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });
      mockEvaluateRetryGate.mockResolvedValue({ shouldRetry: false, reason: "JEV判定でretry不要" });

      searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
        mockResult({
          lines: ["相鉄本線"],
          transferCount: 0,
          estimatedMinutes: 13,
        })
      );

      const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
      
      // JEVがshouldRetry=falseを返したのでretryされない
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(1);
      expect(mockEvaluateRetryGate).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("unavailable");
    });

    test("JEVがshouldRetry=trueを返した場合、retryを実行する。経路一致なら2回目を採用", async () => {
      const CONSISTENT_RAW = { ...VALID_RAW, lines: ["相鉄本線"] };
      mockIsJevAvailable.mockReturnValue(true);
      mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });
      mockEvaluateRetryGate.mockResolvedValueOnce({ shouldRetry: true, reason: "JEV判定でretry必要" });

      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult({
            lines: ["相鉄本線"],
            transferCount: 0,
            estimatedMinutes: 13,
          })
        )
        .mockResolvedValueOnce(mockResult(CONSISTENT_RAW));

      const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
      
      // 1回目でJEVがretryと判定、2回目で成功
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
      expect(mockEvaluateRetryGate).toHaveBeenCalledTimes(1); // 2回目はconfirmedなので呼ばれない
      expect(result?.facility.state).toBe("confirmed");
    });

    test("JEV判定がエラーの場合、ルールベース判定へフォールバックする。経路一致なので2回目も採用", async () => {
      mockIsJevAvailable.mockReturnValue(true);
      mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });
      mockEvaluateRetryGate.mockRejectedValue(new Error("JEV API error"));

      const CONSISTENT_VALID_RAW = { ...VALID_RAW, lines: ["相鉄本線"] }; // 経路を統一
      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult({
            lines: ["相鉄本線"],
            transferCount: 0,
            estimatedMinutes: 13,
          })
        )
        .mockResolvedValueOnce(
          mockResult({
            lines: ["相鉄本線"],
            transferCount: 0,
            estimatedMinutes: 13,
          })
        )
        .mockResolvedValueOnce(mockResult(CONSISTENT_VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");

      // JEVエラー時はルールベースへフォールバック、unavailableなのでretryされる
      // 3回目で成功
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(3);
      expect(mockEvaluateRetryGate).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
    });
  });

  describe("JEV統合（Phase 2-C: Facility完全性評価）", () => {
    afterEach(() => {
      vi.clearAllMocks();
      mockIsJevAvailable.mockReturnValue(false);
      mockCreateJevConfig.mockReturnValue(null);
      mockEvaluateRetryGate.mockResolvedValue({ shouldRetry: false });
      mockEvaluateFacilityCompleteness.mockResolvedValue({
        isComplete: true,
        missingFields: [],
        shouldRetry: false,
      });
      mockEvaluateRouteConsistency.mockResolvedValue({
        isConsistent: true,
        reason: "JEV判定: 同一ルート（確信度: 0.95）",
      });
    });

    test("confirmed状態で改札のみ（exitなし）の場合、Phase 2-CがPhase 1より先に実行されretryを促す", async () => {
      mockIsJevAvailable.mockReturnValue(true);
      mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });
      mockEvaluateFacilityCompleteness.mockResolvedValue({
        isComplete: false,
        missingFields: ["exit"],
        shouldRetry: true,
        reason: "JEV判定: 不完全（確信度: 0.80）",
      });

      // 1回目: gateのみ、exitなし（本番再現）
      const gateOnlySearchText = "詳細情報: 降りる改札は道玄坂改札です。";
      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult(
            {
              lines: ["相鉄・東急直通線"],
              transferCount: 0,
              estimatedMinutes: 35,
              facilityCandidates: [{ gateName: "道玄坂改札", confidence: "medium" }],
            },
            gateOnlySearchText
          )
        )
        .mockResolvedValueOnce(mockResult(VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("test-api-key", NISHIYA, SHIBUYA, "ウエチャベ");

      // Phase 2-Cがretryを促したので2回目が実行される
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
      // 2回目の結果（gate + exit）が採用される
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
      if (result?.facility.state === "confirmed") {
        expect(result.facility.pair.gate?.name).toBe("道玄坂改札");
        expect(result.facility.pair.exit?.name).toBe("A1出口");
      }
      // Phase 2-Cが呼ばれたことを確認
      expect(mockEvaluateFacilityCompleteness).toHaveBeenCalledTimes(1);
      // Phase 1（evaluateRetryGate）は呼ばれない（confirmedの場合Phase 2-Cで確定）
      expect(mockEvaluateRetryGate).not.toHaveBeenCalled();
    });

    test("confirmed状態で改札・出口両方ありの場合、ルールベースで retry 不要と判定し JEV をスキップ", async () => {
      mockIsJevAvailable.mockReturnValue(true);
      mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });

      searchAndGenerateStructuredContentWithSearchText.mockResolvedValueOnce(mockResult(VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("test-api-key", NISHIYA, SHIBUYA, "ウエチャベ");

      // 両方ありなので1回のみ（ルールベースで早期 return、JEV 呼び出し不要）
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
      // JEV は呼ばれない（ルールベースで完全と判定）
      expect(mockEvaluateFacilityCompleteness).not.toHaveBeenCalled();
      expect(mockEvaluateRetryGate).not.toHaveBeenCalled();
    });

    test("unavailable状態の場合、Phase 2-CをスキップしてPhase 1で判定", async () => {
      mockIsJevAvailable.mockReturnValue(true);
      mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });
      mockEvaluateRetryGate.mockResolvedValue({
        shouldRetry: true,
        reason: "JEV判定: 情報不足（確信度: 0.75）",
      });

      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult({
            lines: ["相鉄・東急直通線"],
            transferCount: 0,
            estimatedMinutes: 35,
          })
        )
        .mockResolvedValueOnce(mockResult(VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("test-api-key", NISHIYA, SHIBUYA, "ウエチャベ");

      // Phase 1がretryを促したので2回目が実行される
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
      // Phase 2-Cは呼ばれない（unavailableの場合）
      expect(mockEvaluateFacilityCompleteness).not.toHaveBeenCalled();
      // Phase 1が呼ばれたことを確認
      expect(mockEvaluateRetryGate).toHaveBeenCalledTimes(1);
    });

    test("JEV disabled + confirmed gate-only の場合、ルールベースで retry を実行", async () => {
      mockIsJevAvailable.mockReturnValue(false);

      // 1回目: gateのみ、exitなし
      const gateOnlySearchText = "詳細情報: 降りる改札は道玄坂改札です。";
      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult(
            {
              lines: ["相鉄・東急直通線"],
              transferCount: 0,
              estimatedMinutes: 35,
              facilityCandidates: [{ gateName: "道玄坂改札", confidence: "medium" }],
            },
            gateOnlySearchText
          )
        )
        .mockResolvedValueOnce(mockResult(VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("test-api-key", NISHIYA, SHIBUYA, "ウエチャベ");

      // JEV が無効でも retry が実行される（ルールベース判定）
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
      if (result?.facility.state === "confirmed") {
        expect(result.facility.pair.gate?.name).toBe("道玄坂改札");
        expect(result.facility.pair.exit?.name).toBe("A1出口");
      }
      // JEV は呼ばれない
      expect(mockEvaluateFacilityCompleteness).not.toHaveBeenCalled();
      expect(mockEvaluateRetryGate).not.toHaveBeenCalled();
    });

    test("Phase 2-C rejection → ルールベースで retry を実行", async () => {
      mockIsJevAvailable.mockReturnValue(true);
      mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });
      mockEvaluateFacilityCompleteness.mockRejectedValue(new Error("JEV API timeout"));

      // 1回目: gateのみ、exitなし
      const gateOnlySearchText = "詳細情報: 降りる改札は道玄坂改札です。";
      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult(
            {
              lines: ["相鉄・東急直通線"],
              transferCount: 0,
              estimatedMinutes: 35,
              facilityCandidates: [{ gateName: "道玄坂改札", confidence: "medium" }],
            },
            gateOnlySearchText
          )
        )
        .mockResolvedValueOnce(mockResult(VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("test-api-key", NISHIYA, SHIBUYA, "ウエチャベ");

      // Phase 2-C エラー時も retry が実行される（ルールベースにフォールバック）
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
      if (result?.facility.state === "confirmed") {
        expect(result.facility.pair.gate?.name).toBe("道玄坂改札");
        expect(result.facility.pair.exit?.name).toBe("A1出口");
      }
      // Phase 2-C が呼ばれたが失敗した
      expect(mockEvaluateFacilityCompleteness).toHaveBeenCalledTimes(1);
      // Phase 1 は呼ばれない（confirmed の場合）
      expect(mockEvaluateRetryGate).not.toHaveBeenCalled();
    });

    test("3回の retry: 1回目 gate-only, 2回目 gate-only, 3回目 gate+exit → 3回目を採用", async () => {
      mockIsJevAvailable.mockReturnValue(true);
      mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });
      mockEvaluateFacilityCompleteness.mockResolvedValue({
        isComplete: false,
        missingFields: ["exit"],
        shouldRetry: true,
        reason: "exit が確認できなかった",
      });

      // 1回目・2回目: gate-only
      const gateOnlySearchText = "詳細情報: 降りる改札は道玄坂改札です。";
      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult(
            {
              lines: ["相鉄・東急直通線"],
              transferCount: 0,
              estimatedMinutes: 35,
              facilityCandidates: [{ gateName: "道玄坂改札", confidence: "medium" }],
            },
            gateOnlySearchText
          )
        )
        .mockResolvedValueOnce(
          mockResult(
            {
              lines: ["相鉄・東急直通線"],
              transferCount: 0,
              estimatedMinutes: 35,
              facilityCandidates: [{ gateName: "道玄坂改札", confidence: "medium" }],
            },
            gateOnlySearchText
          )
        )
        .mockResolvedValueOnce(mockResult(VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("test-api-key", NISHIYA, SHIBUYA, "ウエチャベ");

      // 3回目で gate+exit を取得
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(3);
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
      if (result?.facility.state === "confirmed") {
        expect(result.facility.pair.gate?.name).toBe("道玄坂改札");
        expect(result.facility.pair.exit?.name).toBe("A1出口");
      }
    });

    test("3回すべて gate-only → 最後の試行結果を採用", async () => {
      mockIsJevAvailable.mockReturnValue(false);

      // 3回とも gate-only
      const gateOnlySearchText = "詳細情報: 降りる改札は道玄坂改札です。";
      const gateOnlyResult = mockResult(
        {
          lines: ["相鉄・東急直通線"],
          transferCount: 0,
          estimatedMinutes: 35,
          facilityCandidates: [{ gateName: "道玄坂改札", confidence: "medium" }],
        },
        gateOnlySearchText
      );

      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(gateOnlyResult)
        .mockResolvedValueOnce(gateOnlyResult)
        .mockResolvedValueOnce(gateOnlyResult);

      const result = await generateSingleCallNavigatorGuide("test-api-key", NISHIYA, SHIBUYA, "ウエチャベ");

      // 3回試行したが全て gate-only
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(3);
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
      if (result?.facility.state === "confirmed") {
        expect(result.facility.pair.gate?.name).toBe("道玄坂改札");
        expect(result.facility.pair.exit).toBeNull();
      }
    });

    test("2回目で confirmed full を取得した場合、3回目は試行せず早期終了", async () => {
      mockIsJevAvailable.mockReturnValue(false);

      // 1回目: unavailable, 2回目: confirmed full
      searchAndGenerateStructuredContentWithSearchText
        .mockResolvedValueOnce(
          mockResult({
            lines: ["相鉄・東急直通線"],
            transferCount: 0,
            estimatedMinutes: 35,
          })
        )
        .mockResolvedValueOnce(mockResult(VALID_RAW));

      const result = await generateSingleCallNavigatorGuide("test-api-key", NISHIYA, SHIBUYA, "ウエチャベ");

      // 2回目で confirmed full を取得したので、3回目は試行しない
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("confirmed");
      if (result?.facility.state === "confirmed") {
        expect(result.facility.pair.gate?.name).toBe("道玄坂改札");
        expect(result.facility.pair.exit?.name).toBe("A1出口");
      }
    });
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

describe("isRouteConsistent", () => {
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

  afterEach(() => {
    vi.clearAllMocks();
    mockIsJevAvailable.mockReturnValue(false);
  });

  test("同じ路線・乗換回数・番線なら一致", async () => {
    const a = createGuide(["相鉄本線", "東急東横線"], 1, "3");
    const b = createGuide(["相鉄本線", "東急東横線"], 1, "3");
    expect(await isRouteConsistent(a, b)).toBe(true);
  });

  test("番線表記が異なっても数字が一致すれば一致（「3」vs「3番線」）", async () => {
    const a = createGuide(["東急東横線"], 0, "3");
    const b = createGuide(["東急東横線"], 0, "3番線");
    expect(await isRouteConsistent(a, b)).toBe(true);
  });

  test("番線表記が異なっても数字が一致すれば一致（「2」vs「2番ホーム」）", async () => {
    const a = createGuide(["東急東横線"], 0, "2");
    const b = createGuide(["東急東横線"], 0, "2番ホーム");
    expect(await isRouteConsistent(a, b)).toBe(true);
  });

  test("番線が片方nullなら一致とみなす", async () => {
    const a = createGuide(["東急東横線"], 0, "3");
    const b = createGuide(["東急東横線"], 0, null);
    expect(await isRouteConsistent(a, b)).toBe(true);
  });

  test("番線の数字が異なれば不一致", async () => {
    const a = createGuide(["東急東横線"], 0, "3");
    const b = createGuide(["東急東横線"], 0, "5");
    expect(await isRouteConsistent(a, b)).toBe(false);
  });

  test("路線名の中黒の有無は吸収される（「相鉄・JR直通線」vs「相鉄JR直通線」）", async () => {
    const a = createGuide(["相鉄・JR直通線"], 0, null);
    const b = createGuide(["相鉄JR直通線"], 0, null);
    expect(await isRouteConsistent(a, b)).toBe(true);
  });

  test("路線名の末尾「線」の有無は吸収される（「東急東横線」vs「東急東横」）", async () => {
    const a = createGuide(["東急東横線"], 0, null);
    const b = createGuide(["東急東横"], 0, null);
    expect(await isRouteConsistent(a, b)).toBe(true);
  });

  test("路線名の空白は吸収される（「東急 東横線」vs「東急東横線」）", async () => {
    const a = createGuide(["東急 東横線"], 0, null);
    const b = createGuide(["東急東横線"], 0, null);
    expect(await isRouteConsistent(a, b)).toBe(true);
  });

  test("路線名の部分一致は許容される（「東急東横線」⊃「東横線」）", async () => {
    const a = createGuide(["東急東横線"], 0, null);
    const b = createGuide(["東横線"], 0, null);
    expect(await isRouteConsistent(a, b)).toBe(true);
  });

  test("乗換回数が異なれば不一致", async () => {
    const a = createGuide(["相鉄本線", "東急東横線"], 1, "3");
    const b = createGuide(["相鉄本線", "東急東横線"], 0, "3");
    expect(await isRouteConsistent(a, b)).toBe(false);
  });

  test("到着路線（末尾）が異なれば不一致", async () => {
    const a = createGuide(["相鉄本線"], 0, null);
    const b = createGuide(["東急東横線"], 0, null);
    expect(await isRouteConsistent(a, b)).toBe(false);
  });

  test("ルールベースでtrue → JEV呼び出し不要（レイテンシ0）", async () => {
    // JEVが有効でも、ルールベースでtrueなら即座にtrueを返す
    mockIsJevAvailable.mockReturnValue(true);
    mockCreateJevConfig.mockReturnValue({ apiKey: "test_key" });
    
    const a = createGuide(["東急東横線"], 0, "3");
    const b = createGuide(["東急東横線"], 0, "3");
    
    const result = await isRouteConsistent(a, b);
    
    expect(result).toBe(true);
  });

  test("ルールベースでfalse + JEV未設定 → ルールベース結果（false）", async () => {
    mockIsJevAvailable.mockReturnValue(false);
    
    const a = createGuide(["相鉄本線"], 0, null);
    const b = createGuide(["東急東横線"], 0, null);
    
    const result = await isRouteConsistent(a, b);
    
    expect(result).toBe(false);
  });
});

describe("selectFinalGuide", () => {
  const createGuide = (
    facility: 
      | { state: "unavailable" }
      | { state: "alternatives"; pairs: Array<{ gate: string | null; exit: string | null }> }
      | { state: "confirmed"; pair: { gate: string | null; exit: string | null } },
    boarding?: { carNumber: number; doorPosition: string; reason: string; confidenceLevel: ConfidenceLevel }
  ): SingleCallNavigatorGuide => {
    let facilityRecommendation: RawFacilityRecommendation;
    if (facility.state === "unavailable") {
      facilityRecommendation = { state: "unavailable", reason: "テスト用" };
    } else if (facility.state === "alternatives") {
      facilityRecommendation = {
        state: "alternatives",
        pairs: facility.pairs.map((p) => ({
          gate: p.gate ? { name: p.gate, confidenceLevel: "medium" as const } : null,
          exit: p.exit ? { name: p.exit, confidenceLevel: "medium" as const } : null,
          reason: null,
        })),
      };
    } else {
      facilityRecommendation = {
        state: "confirmed",
        pair: {
          gate: facility.pair.gate ? { name: facility.pair.gate, confidenceLevel: "medium" as const } : null,
          exit: facility.pair.exit ? { name: facility.pair.exit, confidenceLevel: "medium" as const } : null,
          reason: null,
        },
      };
    }
    return {
      lines: ["相鉄・東急直通線"],
      transferCount: 0,
      estimatedMinutes: 35,
      arrivalPlatformNumber: "3",
      boarding: boarding || null,
      facility: facilityRecommendation,
    };
  };

  afterEach(() => {
    vi.clearAllMocks();
    mockIsJevAvailable.mockReturnValue(false);
  });

  test("1回目がnull、2回目が正常なら2回目を返す", async () => {
    const second = createGuide({ state: "confirmed", pair: { gate: "道玄坂改札", exit: "A1出口" } });
    const result = await selectFinalGuide(null, second);
    expect(result).toBe(second);
  });

  test("1回目が正常、2回目がnullなら1回目を返す", async () => {
    const first = createGuide({ state: "unavailable" });
    const result = await selectFinalGuide(first, null);
    expect(result).toBe(first);
  });

  test("2回目が悪化（confirmed→alternatives）なら1回目を維持", async () => {
    const first = createGuide({ state: "confirmed", pair: { gate: "改札A", exit: "出口A" } });
    const second = createGuide({
      state: "alternatives",
      pairs: [
        { gate: "改札A", exit: "出口A" },
        { gate: "改札B", exit: "出口B" },
      ],
    });

    const result = await selectFinalGuide(first, second);
    expect(result).toBe(first);
  });

  test("2回目が悪化（alternatives→unavailable）なら1回目を維持", async () => {
    const first = createGuide({
      state: "alternatives",
      pairs: [
        { gate: "改札A", exit: "出口A" },
        { gate: "改札B", exit: "出口B" },
      ],
    });
    const second = createGuide({ state: "unavailable" });

    const result = await selectFinalGuide(first, second);
    expect(result).toBe(first);
  });

  test("confirmed partial → confirmed full は改善として採用", async () => {
    const first = createGuide({ state: "confirmed", pair: { gate: "道玄坂改札", exit: null } });
    const second = createGuide({ state: "confirmed", pair: { gate: "道玄坂改札", exit: "A1出口" } });

    const result = await selectFinalGuide(first, second);
    expect(result).not.toBe(first);
    expect(result?.facility.state).toBe("confirmed");
    if (result?.facility.state === "confirmed") {
      expect(result.facility.pair.gate?.name).toBe("道玄坂改札");
      expect(result.facility.pair.exit?.name).toBe("A1出口");
    }
  });

  test("confirmed full → confirmed partial は悪化として1回目を維持", async () => {
    const first = createGuide({ state: "confirmed", pair: { gate: "道玄坂改札", exit: "A1出口" } });
    const second = createGuide({ state: "confirmed", pair: { gate: "道玄坂改札", exit: null } });

    const result = await selectFinalGuide(first, second);
    expect(result).toBe(first);
  });

  test("confirmed partial (gate) → confirmed partial (exit) は横ばい（lateral）として1回目を維持", async () => {
    const first = createGuide({ state: "confirmed", pair: { gate: "道玄坂改札", exit: null } });
    const second = createGuide({ state: "confirmed", pair: { gate: null, exit: "A1出口" } });

    const result = await selectFinalGuide(first, second);
    expect(result).toBe(first);
  });

  test("confirmed partial → confirmed partial は横ばいとして1回目を維持（boarding も保持）", async () => {
    const first = createGuide(
      { state: "confirmed", pair: { gate: "道玄坂改札", exit: null } },
      { carNumber: 5, doorPosition: "前寄り", reason: "階段が近い", confidenceLevel: "medium" }
    );
    const second = createGuide({ state: "confirmed", pair: { gate: "別の改札", exit: null } });

    const result = await selectFinalGuide(first, second);
    expect(result).toBe(first);
    expect(result?.boarding?.carNumber).toBe(5);
  });

  test("改善時に2回目の boarding が null なら1回目の boarding を保持", async () => {
    const first = createGuide(
      { state: "confirmed", pair: { gate: "道玄坂改札", exit: null } },
      { carNumber: 5, doorPosition: "前寄り", reason: "階段が近い", confidenceLevel: "medium" }
    );
    const second = createGuide({ state: "confirmed", pair: { gate: "道玄坂改札", exit: "A1出口" } });

    const result = await selectFinalGuide(first, second);
    expect(result).not.toBe(first);
    expect(result?.boarding?.carNumber).toBe(5);
    expect(result?.facility.state).toBe("confirmed");
    if (result?.facility.state === "confirmed") {
      expect(result.facility.pair.exit?.name).toBe("A1出口");
    }
  });
});


