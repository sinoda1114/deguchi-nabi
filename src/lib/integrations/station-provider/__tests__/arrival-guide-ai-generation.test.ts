import { afterEach, describe, expect, test, vi } from "vitest";
import { generateArrivalNarrativeSteps } from "../arrival-guide-ai-generation";

const searchAndGenerateStructuredContent = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContent: (...args: unknown[]) =>
    searchAndGenerateStructuredContent(...args),
}));

describe("generateArrivalNarrativeSteps", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("検索プロンプトに駅名・改札名・出口名を含める", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ steps: [] });

    await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口");

    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("渋谷駅");
    expect(searchPrompt).toContain("ヒカリエ改札");
    expect(searchPrompt).toContain("B5出口");
  });

  test("有効なステップをGuideStep[]へ変換し、provenanceはai_inferredにする", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      steps: [
        {
          type: "post_gate_direction",
          title: "改札を出て右",
          instruction: "ヒカリエ改札を出て右へ進んでください。",
          confidence: "medium",
        },
      ],
    });

    const steps = await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口");

    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe("post_gate_direction");
    expect(steps[0].title).toBe("改札を出て右");
    expect(steps[0].provenance).toBe("ai_inferred");
    expect(steps[0].confidence.level).toBe("medium");
  });

  test("自己申告confidence:highはai_inferredの上限mediumへ格下げする(モデル自己申告を鵜呑みにしない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      steps: [
        {
          type: "post_gate_direction",
          title: "改札を出て右",
          instruction: "改札を出て右へ進んでください。",
          confidence: "high",
        },
      ],
    });

    const steps = await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口");
    expect(steps[0].confidence.level).toBe("medium");
  });

  test("許可されていない種別(boarding/ticket_gate/street_exit/platform_facility等)のステップは除外する(重複表示・順序矛盾を避けるため、改札〜出口の間の導線種別のみ許可する)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      steps: [
        {
          type: "boarding",
          title: "1号車",
          instruction: "1号車に乗車してください。",
          confidence: "high",
        },
        {
          type: "street_exit",
          title: "B5出口",
          instruction: "B5出口から出てください。",
          confidence: "high",
        },
        {
          type: "platform_facility",
          title: "エスカレーター",
          instruction: "エスカレーターで上がってください。",
          confidence: "high",
        },
        {
          type: "public_passage",
          title: "地下通路",
          instruction: "地下通路を直進してください。",
          confidence: "medium",
        },
      ],
    });

    const steps = await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口");
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe("public_passage");
  });

  test("座標を渡すと検索プロンプトに緯度経度の曖昧性解消ヒントを含める(同名改札・出口が他の駅にもあるケース対策)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ steps: [] });

    await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口", {
      lat: 35.6591,
      lng: 139.7038,
    });

    const searchPrompt = searchAndGenerateStructuredContent.mock.calls[0][1] as string;
    expect(searchPrompt).toContain("35.6591");
    expect(searchPrompt).toContain("139.7038");
    expect(searchPrompt).toContain("他の駅に存在する場合");
  });

  test("stepsが配列でない場合はクラッシュせず空配列を返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({ steps: {} });
    const steps = await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口");
    expect(steps).toEqual([]);
  });

  test("title/instructionが空文字のステップは除外する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      steps: [
        { type: "public_passage", title: "", instruction: "説明", confidence: "medium" },
        { type: "public_passage", title: "地下通路", instruction: "", confidence: "medium" },
      ],
    });

    const steps = await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口");
    expect(steps).toHaveLength(0);
  });

  test("検索グラウンディングが失敗した場合(null)は空配列を返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue(null);
    const steps = await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口");
    expect(steps).toEqual([]);
  });

  test("stepsが未定義の場合も空配列を返す(クラッシュしない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({});
    const steps = await generateArrivalNarrativeSteps("key", "渋谷駅", "ヒカリエ改札", "B5出口");
    expect(steps).toEqual([]);
  });
});
