import { afterEach, describe, expect, test, vi } from "vitest";
import { generateUnifiedArrivalGuide } from "../unified-arrival-guide-generation";

const searchAndGenerateStructuredContent = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiAiSdkClient", () => ({
  searchAndGenerateStructuredContent: (...args: unknown[]) =>
    searchAndGenerateStructuredContent(...args),
}));

describe("generateUnifiedArrivalGuide", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("gemini-3.5-flashをsearchModelとして渡す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
    const args = searchAndGenerateStructuredContent.mock.calls[0];
    expect(args[5]).toBe("gemini-3.5-flash");
  });

  test("gemini-3.5-flashをextractionModelとして渡す(chore/pin-models-pattern-b: 全箇所gemini-3.5-flash統一のA/B評価対象)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    const args = searchAndGenerateStructuredContent.mock.calls[0];
    expect(args[6]).toBe("gemini-3.5-flash");
  });

  test("標準の55秒より長い検索タイムアウト(90秒)をsearchTimeoutMsとして渡す(2026-07-20 fix/unified-guide-exit-first-derivation: 出口→改札の依存関係を明示する指示追加でプロンプトが長くなり、実機検証で55秒ではTimeoutErrorが発生したため)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    const args = searchAndGenerateStructuredContent.mock.calls[0];
    expect(args[7]).toBe(90_000);
  });

  test("検索プロンプトに出発駅名・乗車路線・方面・到着駅名・鉄道会社を含める", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("西谷駅");
    expect(searchPrompt).toContain("横浜駅");
    expect(searchPrompt).toContain("相鉄");
    expect(searchPrompt).toContain("相鉄本線");
    expect(searchPrompt).toContain("横浜方面");
  });

  test("回答項目を出口→改札→徒歩ルート→乗車位置の順で並べ、出口を起点に改札を選ぶよう依存関係を明示する(2026-07-20 fix/unified-guide-exit-first-derivation: 改札を先に単独で決めると、目的地への近さという根拠を欠いたまま選ばれ、後続の号車判断とも不整合を起こしていたため)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    // 出口→改札→徒歩→号車の依存関係を明示する指示文
    expect(searchPrompt).toContain(
      "出口(目的地に最も近い/最も直接的にたどり着けるもの) → 改札(その出口に直接つながる、またはその出口を利用する際に必ず通るもの) → その出口を経由する徒歩ルート → 乗車位置(その改札に最短で着ける号車)"
    );
    // 項目1が出口、項目2が改札(1の出口を起点にする指示付き)であることを確認
    const exitIndex = searchPrompt.indexOf("1. ");
    const gateIndex = searchPrompt.indexOf("2. 1の出口に直接つながる");
    expect(exitIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(exitIndex);
  });

  test("乗車路線が判明している場合、複数事業者駅の注意書き(乗車路線を根拠にした事業者固有設備の優先指示)を検索プロンプトに含める", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "", // destinationOperatorは常に空文字になりうる(HeartRailsが提供しないため)
      ["相鉄本線"],
      null,
      null,
      null
    );

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("複数の鉄道会社");
    expect(searchPrompt).toContain("相鉄本線");
    expect(searchPrompt).toContain("他社線専用の連絡改札");
  });

  test("destinationHintがある場合、検索プロンプトに目的地施設名・目的地の実座標を含め絞り込み型の指示にする", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "kawara CAFE&DINING 横浜店",
      { lat: 35.4662, lng: 139.6227 }, // 駅の中心座標(同名駅の識別用)
      { lat: 35.4657, lng: 139.622 } // 目的地施設の実座標
    );

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("kawara CAFE&DINING 横浜店");
    expect(searchPrompt).toContain("最も直接的にたどり着ける出口名");
    // 目的地施設の実座標(35.4657/139.622)が含まれる(駅座標35.4662/139.6227とは別物)。
    expect(searchPrompt).toContain("35.4657");
    expect(searchPrompt).toContain("139.6220");
  });

  test("boardingPosition/gate/exit/walkingStepsを正しく変換する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      boardingCarNumber: 6,
      boardingDoorPosition: "後方",
      boardingReason: "1階改札への階段に近いため",
      boardingConfidence: "medium",
      gateName: "相鉄線1階改札",
      gateConfidence: "medium",
      exitName: "みなみ西口(相鉄口)",
      exitConfidence: "medium",
      walkingSteps: [
        { title: "改札を出て直進", instruction: "改札を出て直進してください。", confidence: "medium" },
      ],
    });

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result).toEqual({
      boardingPosition: {
        carNumber: 6,
        doorPosition: "後方",
        reason: "1階改札への階段に近いため",
        confidenceLevel: "medium",
      },
      gate: { name: "相鉄線1階改札", confidenceLevel: "medium" },
      exit: { name: "みなみ西口(相鉄口)", confidenceLevel: "medium" },
      walkingSteps: [
        {
          title: "改札を出て直進",
          instruction: "改札を出て直進してください。",
          confidenceLevel: "medium",
        },
      ],
    });
  });

  test("boardingCarNumber等が省略された場合はboardingPositionをnullとして扱う(確認できない場合を創作しない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      gateName: "1F改札",
      gateConfidence: "medium",
      walkingSteps: [],
    });

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result?.boardingPosition).toBeNull();
  });

  test("boardingCarNumberが範囲外(0や17以上)の場合はboardingPositionをnullとして扱う", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      boardingCarNumber: 17,
      boardingDoorPosition: "後方",
      boardingReason: "理由",
      boardingConfidence: "medium",
      walkingSteps: [],
    });

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result?.boardingPosition).toBeNull();
  });

  test("gateName/exitNameが省略された場合はnullとして扱う(確認できない場合を創作しない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      walkingSteps: [],
    });

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result).toEqual({ boardingPosition: null, gate: null, exit: null, walkingSteps: [] });
  });

  test("confidenceが不正な値のwalkingStepは除外する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      walkingSteps: [
        { title: "正常", instruction: "正常なステップ", confidence: "medium" },
        { title: "不正", instruction: "不正なステップ", confidence: "invalid" },
      ],
    });

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result?.walkingSteps).toEqual([
      { title: "正常", instruction: "正常なステップ", confidenceLevel: "medium" },
    ]);
  });

  test("walkingStepsが上限件数を超える場合は先頭から切り詰める", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      walkingSteps: Array.from({ length: 10 }, (_, i) => ({
        title: `見出し${i}`,
        instruction: `ステップ${i}`,
        confidence: "medium",
      })),
    });

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result?.walkingSteps).toHaveLength(6);
  });

  test("検索・応答が失敗(null)した場合はnullを返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue(null);

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "相鉄本線",
      "横浜方面",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result).toBeNull();
  });
});
