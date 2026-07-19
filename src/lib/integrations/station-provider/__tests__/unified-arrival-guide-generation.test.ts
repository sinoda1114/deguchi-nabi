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

  test("検索プロンプトに出発駅名・到着駅名・鉄道会社を含める", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
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
  });

  test("destinationHintがある場合、検索プロンプトに目的地施設名・目的地の実座標を含め絞り込み型の指示にする", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ walkingSteps: [] });

    await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      "kawara CAFE&DINING 横浜店",
      { lat: 35.4662, lng: 139.6227 }, // 駅の中心座標(同名駅の識別用)
      { lat: 35.4657, lng: 139.622 } // 目的地施設の実座標
    );

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("kawara CAFE&DINING 横浜店");
    expect(searchPrompt).toContain("最も近いもの");
    // 目的地施設の実座標(35.4657/139.622)が含まれる(駅座標35.4662/139.6227とは別物)。
    expect(searchPrompt).toContain("35.4657");
    expect(searchPrompt).toContain("139.6220");
  });

  test("gate/exit/walkingStepsを正しく変換する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      gateName: "1F改札",
      gateConfidence: "medium",
      exitName: "五番街口",
      exitConfidence: "medium",
      walkingSteps: [
        { title: "改札を出て直進", instruction: "改札を出て直進してください。", confidence: "medium" },
      ],
    });

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result).toEqual({
      gate: { name: "1F改札", confidenceLevel: "medium" },
      exit: { name: "五番街口", confidenceLevel: "medium" },
      walkingSteps: [
        {
          title: "改札を出て直進",
          instruction: "改札を出て直進してください。",
          confidenceLevel: "medium",
        },
      ],
    });
  });

  test("gateName/exitNameが省略された場合はnullとして扱う(確認できない場合を創作しない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      walkingSteps: [],
    });

    const result = await generateUnifiedArrivalGuide(
      "key",
      "西谷駅",
      "横浜駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null,
      null
    );

    expect(result).toEqual({ gate: null, exit: null, walkingSteps: [] });
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
