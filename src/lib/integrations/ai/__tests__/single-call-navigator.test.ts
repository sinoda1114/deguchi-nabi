import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildNavigatorSearchPrompt,
  buildSharedGuideCacheKey,
  generateSingleCallNavigatorGuide,
  getSharedSingleCallNavigatorGuide,
  getSharedSingleCallNavigatorRun,
  isRouteConsistent,
  peekSharedSingleCallNavigatorRun,
  selectFinalGuide,
  type SingleCallNavigatorGuide,
} from "../single-call-navigator";
import type { Station } from "@/lib/domain/station";
import { UECHABE_DOGENZAKA } from "@/lib/eval/exit-quality-gate";

const searchAndGenerateStructuredContentWithSearchText = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContentWithSearchText: (...args: unknown[]) =>
    searchAndGenerateStructuredContentWithSearchText(...args),
}));

// JevClientのモック
const mockEvaluateRetryGate = vi.fn();
const mockIsJevAvailable = vi.fn();
const mockCreateJevConfig = vi.fn();
const mockSelectBestFacilityPair = vi.fn();
vi.mock("@/lib/integrations/ai/JevClient", () => ({
  evaluateRetryGate: (...args: unknown[]) => mockEvaluateRetryGate(...args),
  isJevAvailable: () => mockIsJevAvailable(),
  createJevConfig: () => mockCreateJevConfig(),
  selectBestFacilityPair: (...args: unknown[]) => mockSelectBestFacilityPair(...args),
  evaluateRouteConsistency: vi.fn(),
  evaluateFacilityCompleteness: vi.fn(),
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

  test("収録確定の改札があるとき号車をその改札基準にし施設選定ブロックを出さない", () => {
    const prompt = buildNavigatorSearchPrompt(
      NISHIYA,
      SHIBUYA,
      "ウエチャベ",
      UECHABE_DOGENZAKA.coordinates
    );
    expect(prompt).toContain("収録データで「道玄坂改札」に確定");
    expect(prompt).toContain("改札名・出口名の選定・比較・逆算は行わず");
    expect(prompt).toContain("改札が確定していても検索自体を省略してはならない");
    expect(prompt).not.toContain("目的地からの逆算");
    expect(prompt).not.toContain("複数改札がある駅での比較");
    expect(prompt).not.toContain("ハチ公改札");
  });

  test("収録改札が無いときは施設選定条項を足さない", () => {
    const prompt = buildNavigatorSearchPrompt(NISHIYA, SHIBUYA, "ウエチャベ");
    expect(prompt).not.toContain("【収録確定の改札】");
    expect(prompt).toContain("目的地からの逆算");
  });

  test("includeCatalogGate を切ると座標があっても収録条項を出さない", () => {
    const prompt = buildNavigatorSearchPrompt(
      NISHIYA,
      SHIBUYA,
      "ウエチャベ",
      UECHABE_DOGENZAKA.coordinates,
      { includeCatalogGate: false }
    );
    expect(prompt).not.toContain("【収録確定の改札】");
    expect(prompt).toContain("目的地からの逆算");
  });
});

describe("generateSingleCallNavigatorGuide", () => {
  afterEach(() => {
    vi.clearAllMocks();
    // JEVモックをリセット
    mockIsJevAvailable.mockReturnValue(false);
    mockCreateJevConfig.mockReturnValue(null);
    mockEvaluateRetryGate.mockResolvedValue({ shouldRetry: false });
    mockSelectBestFacilityPair.mockReset();
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

  test("収録改札があるとき facility unavailable でも施設再試行しない(経路の .first を維持)", async () => {
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult({
        lines: ["相鉄本線"],
        transferCount: 0,
        estimatedMinutes: 13,
        boardingCarNumber: 8,
        boardingDoorPosition: "前方",
        boardingReason: "道玄坂改札の階段に近いため",
        boardingConfidence: "medium",
      })
    );

    const result = await generateSingleCallNavigatorGuide(
      "key",
      NISHIYA,
      SHIBUYA,
      "ウエチャベ",
      UECHABE_DOGENZAKA.coordinates
    );

    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(1);
    expect(result?.lines).toEqual(["相鉄本線"]);
    expect(result?.boarding?.carNumber).toBe(8);
    expect(result?.facility.state).toBe("unavailable");
  });

  test("収録改札があっても 1 回目が null なら経路再試行する", async () => {
    searchAndGenerateStructuredContentWithSearchText
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockResult(VALID_RAW));

    const result = await generateSingleCallNavigatorGuide(
      "key",
      NISHIYA,
      SHIBUYA,
      "ウエチャベ",
      UECHABE_DOGENZAKA.coordinates
    );

    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
    expect(result?.lines).toEqual(["相鉄・東急直通線"]);

    const firstPrompt = String(searchAndGenerateStructuredContentWithSearchText.mock.calls[0]?.[1]);
    const retryPrompt = String(searchAndGenerateStructuredContentWithSearchText.mock.calls[1]?.[1]);
    expect(firstPrompt).toContain("【収録確定の改札】");
    expect(retryPrompt).not.toContain("【収録確定の改札】");
    expect(retryPrompt).toContain("目的地からの逆算");
  });

  test("収録改札があるとき alternatives でも JEV 候補選択を呼ばない", async () => {
    mockIsJevAvailable.mockReturnValue(true);
    mockCreateJevConfig.mockReturnValue({ apiKey: "jev" });
    mockSelectBestFacilityPair.mockResolvedValue({ selectedIndex: 0, reason: "should not run" });
    searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
      mockResult(
        {
          ...VALID_RAW,
          facilityCandidates: [
            { gateName: "道玄坂改札", exitName: "A1出口", confidence: "medium" },
            { gateName: "ハチ公改札", exitName: "ハチ公口", confidence: "medium" },
          ],
        },
        `${VALID_SEARCH_TEXT} ハチ公改札 ハチ公口`
      )
    );

    const result = await generateSingleCallNavigatorGuide(
      "key",
      NISHIYA,
      SHIBUYA,
      "ウエチャベ",
      UECHABE_DOGENZAKA.coordinates
    );

    expect(mockSelectBestFacilityPair).not.toHaveBeenCalled();
    expect(result?.facility.state).toBe("alternatives");
  });

  describe("JEV統合（Phase 1: retry gate判定）", () => {
    test("JEV_API_KEYが設定されていない場合、従来のルールベース判定を使用する", async () => {
      mockIsJevAvailable.mockReturnValue(false);
      searchAndGenerateStructuredContentWithSearchText.mockResolvedValue(
        mockResult({
          lines: ["相鉄本線"],
          transferCount: 0,
          estimatedMinutes: 13,
        })
      );

      const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
      
      // unavailableなのでretryされる（従来挙動）
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
      expect(mockEvaluateRetryGate).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("unavailable");
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
        );

      const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
      
      // JEVエラー時はルールベースへフォールバック、unavailableなのでretryされる
      // 両方unavailableなので1回目を維持
      expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
      expect(mockEvaluateRetryGate).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.facility.state).toBe("unavailable");
    });
  });
});

const SHARED_GUIDE_OK: SingleCallNavigatorGuide = {
  lines: ["相鉄本線"],
  transferCount: 0,
  estimatedMinutes: 35,
  arrivalPlatformNumber: null,
  boarding: {
    carNumber: 8,
    doorPosition: "前方",
    reason: "道玄坂改札の階段に近いため",
    confidenceLevel: "medium",
  },
  facility: { state: "unavailable", reason: "テスト用" },
};

describe("getSharedSingleCallNavigatorGuide", () => {
  test("同じキーで短時間内に呼ばれた場合、成功したfinalはgeneratorを1回しか実行しない(2重課金防止)", async () => {
    const generator = vi.fn().mockResolvedValue(SHARED_GUIDE_OK);
    const key = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "成功再利用");

    await getSharedSingleCallNavigatorGuide(key, generator);
    await getSharedSingleCallNavigatorGuide(key, generator);

    expect(generator).toHaveBeenCalledTimes(1);
  });

  test("決着したnullは再利用せず、次のgetSharedでgeneratorを再実行する(再検索が即落ちしない)", async () => {
    const generator = vi.fn().mockResolvedValue(null);
    const key = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "失敗は再利用しない");

    await getSharedSingleCallNavigatorGuide(key, generator);
    await getSharedSingleCallNavigatorGuide(key, generator);

    expect(generator).toHaveBeenCalledTimes(2);
  });

  test("in-flight中はfinalがnull予定でも同一runを共有する", async () => {
    const key = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "in-flight共有");
    let resolveFinal!: (value: SingleCallNavigatorGuide | null) => void;
    const pending = new Promise<SingleCallNavigatorGuide | null>((resolve) => {
      resolveFinal = resolve;
    });
    const generator = vi.fn(() => ({
      first: pending,
      final: pending,
    }));

    const run1 = getSharedSingleCallNavigatorRun(key, generator);
    const run2 = getSharedSingleCallNavigatorRun(key, generator);
    expect(generator).toHaveBeenCalledTimes(1);
    expect(run1).toBe(run2);

    resolveFinal(null);
    await pending;
    getSharedSingleCallNavigatorRun(key, generator);
    expect(generator).toHaveBeenCalledTimes(2);
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

describe("peekSharedSingleCallNavigatorRun", () => {
  test("未登録キーは null で、generator は起動しない", () => {
    const key = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "peek-miss");
    expect(peekSharedSingleCallNavigatorRun(key)).toBeNull();
  });

  test("共有済み run を generator なしで返す", async () => {
    const key = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "peek-hit");
    const generator = vi.fn(() => ({
      first: Promise.resolve(null),
      final: Promise.resolve(null),
    }));
    getSharedSingleCallNavigatorRun(key, generator);
    const peeked = peekSharedSingleCallNavigatorRun(key);
    expect(peeked).not.toBeNull();
    expect(generator).toHaveBeenCalledTimes(1);
    await peeked?.first;
  });

  test("決着したnullのあとpeekはnullを返す(失敗runを号車に使わない)", async () => {
    const key = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "peek-after-null");
    await getSharedSingleCallNavigatorGuide(key, () => Promise.resolve(null));
    expect(peekSharedSingleCallNavigatorRun(key)).toBeNull();
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
    lines: string[],
    transferCount: number,
    platform: string | null,
    facilityState: "unavailable" | "alternatives" | "confirmed"
  ): SingleCallNavigatorGuide => ({
    lines,
    transferCount,
    estimatedMinutes: 35,
    arrivalPlatformNumber: platform,
    boarding: null,
    facility:
      facilityState === "unavailable"
        ? { state: "unavailable", reason: "テスト用" }
        : facilityState === "alternatives"
          ? {
              state: "alternatives",
              pairs: [
                {
                  gate: { name: "道玄坂改札", confidenceLevel: "medium" },
                  exit: { name: "A1出口", confidenceLevel: "medium" },
                  reason: null,
                },
              ],
            }
          : {
              state: "confirmed",
              pair: {
                gate: { name: "道玄坂改札", confidenceLevel: "high" },
                exit: { name: "A1出口", confidenceLevel: "high" },
                reason: null,
              },
            },
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockIsJevAvailable.mockReturnValue(false);
  });

  test("1回目がnull、2回目が正常なら2回目を返す", async () => {
    const first = null;
    const second = createGuide(["東急東横線"], 0, "3", "confirmed");
    expect(await selectFinalGuide(first, second)).toBe(second);
  });

  test("1回目が正常、2回目がnullなら1回目を返す", async () => {
    const first = createGuide(["東急東横線"], 0, "3", "unavailable");
    const second = null;
    expect(await selectFinalGuide(first, second)).toBe(first);
  });

  test("2回目が悪化（confirmed→alternatives）なら1回目を維持", async () => {
    const first = createGuide(["東急東横線"], 0, "3", "confirmed");
    const second = createGuide(["東急東横線"], 0, "3", "alternatives");
    expect(await selectFinalGuide(first, second)).toBe(first);
  });

  test("2回目が悪化（alternatives→unavailable）なら1回目を維持", async () => {
    const first = createGuide(["東急東横線"], 0, "3", "alternatives");
    const second = createGuide(["東急東横線"], 0, "3", "unavailable");
    expect(await selectFinalGuide(first, second)).toBe(first);
  });

  test("経路不一致なら1回目を維持（改善があっても矛盾を防ぐ）", async () => {
    const first = createGuide(["相鉄本線"], 0, null, "unavailable");
    const second = createGuide(["東急東横線"], 0, null, "confirmed");
    expect(await selectFinalGuide(first, second)).toBe(first);
  });

  test("経路一致 & 改善（unavailable→confirmed）なら2回目のfacilityを採用", async () => {
    const first = createGuide(["東急東横線"], 0, "3", "unavailable");
    const second = createGuide(["東急東横線"], 0, "3", "confirmed");
    const result = await selectFinalGuide(first, second);
    
    expect(result?.lines).toEqual(first.lines);
    expect(result?.facility.state).toBe("confirmed");
  });

  test("経路一致 & 改善（unavailable→alternatives）なら2回目のfacilityを採用", async () => {
    const first = createGuide(["東急東横線"], 0, "3", "unavailable");
    const second = createGuide(["東急東横線"], 0, "3", "alternatives");
    const result = await selectFinalGuide(first, second);
    
    expect(result?.lines).toEqual(first.lines);
    expect(result?.facility.state).toBe("alternatives");
  });

  test("番線表記が異なっても数字一致なら経路一致として改善を採用（「3」vs「3番線」）", async () => {
    const first = createGuide(["東急東横線"], 0, "3", "unavailable");
    const second = createGuide(["東急東横線"], 0, "3番線", "confirmed");
    const result = await selectFinalGuide(first, second);
    
    expect(result?.facility.state).toBe("confirmed");
  });

  test("路線名の中黒有無が異なっても経路一致として改善を採用", async () => {
    const first = createGuide(["相鉄・東急直通線"], 0, null, "unavailable");
    const second = createGuide(["相鉄東急直通線"], 0, null, "confirmed");
    const result = await selectFinalGuide(first, second);
    
    expect(result?.facility.state).toBe("confirmed");
  });
});
