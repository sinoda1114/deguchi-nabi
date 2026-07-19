import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const findStationFloorMapImage = vi.fn();
vi.mock("@/lib/integrations/search/facilities-image-search", () => ({
  findStationFloorMapImage: (...args: unknown[]) => findStationFloorMapImage(...args),
}));

const searchAndGenerateStructuredContentWithImage = vi.fn();
const searchAndGenerateStructuredContent = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContentWithImage: (...args: unknown[]) =>
    searchAndGenerateStructuredContentWithImage(...args),
  searchAndGenerateStructuredContent: (...args: unknown[]) =>
    searchAndGenerateStructuredContent(...args),
}));

const { generateStationFacilitiesWithVision } = await import("../facilities-vision-generation");

const VALID_FACILITY = {
  facilityType: "gate",
  name: "南改札口",
  level: "2階",
  confidence: "medium",
};

describe("generateStationFacilitiesWithVision", () => {
  beforeEach(() => {
    findStationFloorMapImage.mockReset();
    searchAndGenerateStructuredContentWithImage.mockReset();
    searchAndGenerateStructuredContent.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("画像が取得できた場合、画像付きGrounding呼び出しの結果を返す", async () => {
    findStationFloorMapImage.mockResolvedValue({ data: "base64data", mimeType: "image/png" });
    searchAndGenerateStructuredContentWithImage.mockResolvedValue({
      facilities: [VALID_FACILITY],
    });

    const result = await generateStationFacilitiesWithVision(
      "gemini-key",
      "serper-key",
      "大宮駅",
      "JR東日本",
      ["JR京浜東北線"],
      null,
      null
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("南改札口");
    expect(searchAndGenerateStructuredContentWithImage).toHaveBeenCalledTimes(1);
    expect(searchAndGenerateStructuredContent).not.toHaveBeenCalled();
  });

  test("画像が取得できない場合、画像なしGroundingにフォールバックする", async () => {
    findStationFloorMapImage.mockResolvedValue(null);
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: [VALID_FACILITY] });

    const result = await generateStationFacilitiesWithVision(
      "gemini-key",
      "serper-key",
      "西谷駅",
      "相鉄",
      ["相鉄本線"],
      null,
      null
    );

    expect(result).toHaveLength(1);
    expect(searchAndGenerateStructuredContentWithImage).not.toHaveBeenCalled();
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });

  test("画像付き呼び出しがnullを返した場合は画像なしGroundingへフォールバックする(実測: Gemini画像付き呼び出しは同一条件でも失敗することがあるフレーク挙動を確認したため)", async () => {
    findStationFloorMapImage.mockResolvedValue({ data: "base64data", mimeType: "image/png" });
    searchAndGenerateStructuredContentWithImage.mockResolvedValue(null);
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: [VALID_FACILITY] });

    const result = await generateStationFacilitiesWithVision(
      "gemini-key",
      "serper-key",
      "大宮駅",
      "JR東日本",
      ["JR京浜東北線"],
      null,
      null
    );

    expect(result).toHaveLength(1);
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });

  test("画像付き呼び出しがfacilities空配列を返した場合も画像なしGroundingへフォールバックする", async () => {
    findStationFloorMapImage.mockResolvedValue({ data: "base64data", mimeType: "image/png" });
    searchAndGenerateStructuredContentWithImage.mockResolvedValue({ facilities: [] });
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: [VALID_FACILITY] });

    const result = await generateStationFacilitiesWithVision(
      "gemini-key",
      "serper-key",
      "大宮駅",
      "JR東日本",
      ["JR京浜東北線"],
      null,
      null
    );

    expect(result).toHaveLength(1);
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });

  test("不正なfacility(必須フィールド欠如)は除外される", async () => {
    findStationFloorMapImage.mockResolvedValue({ data: "base64data", mimeType: "image/png" });
    searchAndGenerateStructuredContentWithImage.mockResolvedValue({
      facilities: [VALID_FACILITY, { facilityType: "gate" }],
    });

    const result = await generateStationFacilitiesWithVision(
      "gemini-key",
      "serper-key",
      "大宮駅",
      "JR東日本",
      ["JR京浜東北線"],
      null,
      null
    );

    expect(result).toHaveLength(1);
  });

  test("配列の要素が全て不正(isValidFacilityで全滅)の場合も画像なしGroundingへフォールバックする(/ai-review指摘、Medium: フィルタ前の配列長のみでフォールバック判定していたバグ)", async () => {
    findStationFloorMapImage.mockResolvedValue({ data: "base64data", mimeType: "image/png" });
    searchAndGenerateStructuredContentWithImage.mockResolvedValue({
      facilities: [{ facilityType: "gate" }, { name: "出口A" }],
    });
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: [VALID_FACILITY] });

    const result = await generateStationFacilitiesWithVision(
      "gemini-key",
      "serper-key",
      "大宮駅",
      "JR東日本",
      ["JR京浜東北線"],
      null,
      null
    );

    expect(result).toHaveLength(1);
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });

  test("destinationHintを画像付き検索プロンプトへ伝播する", async () => {
    findStationFloorMapImage.mockResolvedValue({ data: "base64data", mimeType: "image/png" });
    searchAndGenerateStructuredContentWithImage.mockResolvedValue({ facilities: [] });

    await generateStationFacilitiesWithVision(
      "gemini-key",
      "serper-key",
      "大宮駅",
      "JR東日本",
      ["JR京浜東北線"],
      null,
      "大宮アルシェ"
    );

    const [, searchPrompt] = searchAndGenerateStructuredContentWithImage.mock.calls[0];
    expect(searchPrompt).toContain("大宮アルシェ");
  });

  test("facilitiesが配列でない不正応答の場合も画像なしGroundingへフォールバックする", async () => {
    findStationFloorMapImage.mockResolvedValue({ data: "base64data", mimeType: "image/png" });
    searchAndGenerateStructuredContentWithImage.mockResolvedValue({ facilities: "not-an-array" });
    searchAndGenerateStructuredContent.mockResolvedValue({ facilities: [] });

    const result = await generateStationFacilitiesWithVision(
      "gemini-key",
      "serper-key",
      "大宮駅",
      "JR東日本",
      ["JR京浜東北線"],
      null,
      null
    );

    expect(result).toEqual([]);
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });
});
