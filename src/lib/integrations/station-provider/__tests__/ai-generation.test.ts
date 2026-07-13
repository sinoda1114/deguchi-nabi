import { afterEach, describe, expect, test, vi } from "vitest";
import {
  generateBoardingPosition,
  generateStationFacilities,
  isPlainArrivalPlatformLabel,
} from "../ai-generation";

const searchAndGenerateStructuredContent = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContent: (...args: unknown[]) =>
    searchAndGenerateStructuredContent(...args),
}));

describe("generateStationFacilities", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("Search Groundingで検索の裏付けを取る(searchAndGenerateStructuredContentを使う)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: [] });

    await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"]);

    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });

  test("検索プロンプトに駅名・事業者名・路線名を含め、公式構内図を最優先の情報源とするよう指示する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: [] });

    await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"]);

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("渋谷駅");
    expect(searchPrompt).toContain("東急電鉄");
    expect(searchPrompt).toContain("東急東横線");
    expect(searchPrompt).toContain("公式");
    expect(searchPrompt).toContain("創作せず");
  });

  test("座標を渡すと検索プロンプトに緯度経度の曖昧性解消ヒントを含める(同名駅対策)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: [] });

    await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"], {
      lat: 35.658,
      lng: 139.7016,
    });

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("35.6580");
    expect(searchPrompt).toContain("139.7016");
  });

  test("有効なfacilityをStationFacility[]へ変換し、provenanceをai_inferredにする", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      facilities: [
        { facilityType: "gate", name: "ヒカリエ改札", level: "地上1階", confidence: "medium" },
      ],
    });

    const result = await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"]);

    expect(result).toHaveLength(1);
    expect(result[0].facilityType).toBe("gate");
    expect(result[0].name).toBe("ヒカリエ改札");
    expect(result[0].provenance).toBe("ai_inferred");
    expect(result[0].confidence.level).toBe("medium");
  });

  test("自己申告confidence:highはai_inferredの上限mediumへ格下げする(モデル自己申告を鵜呑みにしない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      facilities: [
        { facilityType: "exit", name: "B5出口", level: "地下1階", confidence: "high" },
      ],
    });

    const result = await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"]);
    expect(result[0].confidence.level).toBe("medium");
  });

  test("facilitiesが配列でない場合はクラッシュせず空配列を返す(過去のレビュー指摘対応)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: {} });

    const result = await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"]);
    expect(result).toEqual([]);
  });

  test("facilitiesが未定義の場合も空配列を返す(クラッシュしない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({});

    const result = await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"]);
    expect(result).toEqual([]);
  });

  test("検索グラウンディングが失敗した場合(null)は空配列を返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue(null);

    const result = await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"]);
    expect(result).toEqual([]);
  });

  test("facilityType不正・name/levelが空文字・confidence不正な項目は除外する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      facilities: [
        { facilityType: "invalid", name: "改札", level: "1F", confidence: "medium" },
        { facilityType: "gate", name: "", level: "1F", confidence: "medium" },
        { facilityType: "gate", name: "改札", level: "", confidence: "medium" },
        { facilityType: "gate", name: "改札", level: "1F", confidence: "invalid" },
        { facilityType: "gate", name: "正常な改札", level: "1F", confidence: "low" },
      ],
    });

    const result = await generateStationFacilities("key", "渋谷駅", "東急電鉄", ["東急東横線"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("正常な改札");
  });
});

describe("generateBoardingPosition", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("Search Groundingで検索の裏付けを取る(searchAndGenerateStructuredContentを使う)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "前方",
      reason: "階段に近いため",
      confidence: "medium",
    });

    await generateBoardingPosition("key", "渋谷駅", "JR山手線", "新宿方面", "pf_shibuya_jr_yamanote");

    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });

  test("検索プロンプトに駅名・路線名・方面を含め、進行方向・編成両数の照合を明示的に指示する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "前方",
      reason: "階段に近いため",
      confidence: "medium",
    });

    await generateBoardingPosition("key", "渋谷駅", "JR山手線", "新宿方面", "pf_shibuya_jr_yamanote");

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("渋谷駅");
    expect(searchPrompt).toContain("JR山手線");
    expect(searchPrompt).toContain("新宿方面");
    expect(searchPrompt).toContain("進行方向");
    expect(searchPrompt).toContain("編成両数");
  });

  test("arrivalPlatformNumberを渡すと検索プロンプトにその番線を優先する指示を含める", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "前方",
      reason: "階段に近いため",
      confidence: "medium",
    });

    await generateBoardingPosition(
      "key",
      "渋谷駅",
      "JR山手線",
      "新宿方面",
      "pf_shibuya_jr_yamanote",
      "5"
    );

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("5番線");
  });

  test("arrivalPlatformNumberを省略した場合は番線ヒントを含めない", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "前方",
      reason: "階段に近いため",
      confidence: "medium",
    });

    await generateBoardingPosition("key", "渋谷駅", "JR山手線", "新宿方面", "pf_shibuya_jr_yamanote");

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).not.toContain("番線と判明");
  });

  test("有効な結果をBoardingPositionへ変換する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "前方",
      reason: "階段に近いため",
      confidence: "medium",
    });

    const result = await generateBoardingPosition(
      "key",
      "渋谷駅",
      "JR山手線",
      "新宿方面",
      "pf_shibuya_jr_yamanote"
    );

    expect(result?.carNumber).toBe(4);
    expect(result?.doorPosition).toBe("前方");
    expect(result?.platformId).toBe("pf_shibuya_jr_yamanote");
    expect(result?.confidence.level).toBe("medium");
  });

  test("自己申告confidence:highはai_inferredの上限mediumへ格下げする", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "前方",
      reason: "階段に近いため",
      confidence: "high",
    });

    const result = await generateBoardingPosition(
      "key",
      "渋谷駅",
      "JR山手線",
      "新宿方面",
      "pf_shibuya_jr_yamanote"
    );
    expect(result?.confidence.level).toBe("medium");
  });

  test("carNumberが範囲外(0や17以上)の場合はnullを返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 17,
      doorPosition: "前方",
      reason: "階段に近いため",
      confidence: "medium",
    });

    const result = await generateBoardingPosition(
      "key",
      "渋谷駅",
      "JR山手線",
      "新宿方面",
      "pf_shibuya_jr_yamanote"
    );
    expect(result).toBeNull();
  });

  test("doorPositionが不正な値の場合はnullを返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "右側",
      reason: "階段に近いため",
      confidence: "medium",
    });

    const result = await generateBoardingPosition(
      "key",
      "渋谷駅",
      "JR山手線",
      "新宿方面",
      "pf_shibuya_jr_yamanote"
    );
    expect(result).toBeNull();
  });

  test("検索グラウンディングが失敗した場合(null)はnullを返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue(null);

    const result = await generateBoardingPosition(
      "key",
      "渋谷駅",
      "JR山手線",
      "新宿方面",
      "pf_shibuya_jr_yamanote"
    );
    expect(result).toBeNull();
  });

  test("reasonが200字を超えても300字以内なら棄却しない(条件付き案内で長くなりやすいため、facility系より緩い上限を許容する)", async () => {
    const longReason = "◯番線着の場合は◯号車、△番線着の場合は△号車、という条件が長くなるケース。".repeat(7);
    expect(longReason.length).toBeGreaterThan(200);
    expect(longReason.length).toBeLessThanOrEqual(300);
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "前方",
      reason: longReason,
      confidence: "medium",
    });

    const result = await generateBoardingPosition(
      "key",
      "渋谷駅",
      "JR山手線",
      "新宿方面",
      "pf_shibuya_jr_yamanote"
    );
    expect(result).not.toBeNull();
    expect(result?.reason).toBe(longReason);
  });

  test("reasonが300字を超える場合はnullを返す(上限はあくまで存在する)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      carNumber: 4,
      doorPosition: "前方",
      reason: "あ".repeat(301),
      confidence: "medium",
    });

    const result = await generateBoardingPosition(
      "key",
      "渋谷駅",
      "JR山手線",
      "新宿方面",
      "pf_shibuya_jr_yamanote"
    );
    expect(result).toBeNull();
  });
});

describe("isPlainArrivalPlatformLabel", () => {
  test("空文字はfalse", () => {
    expect(isPlainArrivalPlatformLabel("")).toBe(false);
  });

  test("fixture platformId('pf_'接頭辞)はfalse(別駅のplatformIdを番線ラベルとして誤用しないため)", () => {
    expect(isPlainArrivalPlatformLabel("pf_shibuya_jr_yamanote")).toBe(false);
  });

  test("AI検索で確認できた素の番線ラベルはtrue", () => {
    expect(isPlainArrivalPlatformLabel("3")).toBe(true);
  });
});
