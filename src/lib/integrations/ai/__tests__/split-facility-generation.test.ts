import { describe, expect, test, vi } from "vitest";
import { generateSplitFacilityPair } from "@/lib/integrations/ai/split-facility-generation";

vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContentWithSearchText: vi.fn(),
}));

import { searchAndGenerateStructuredContentWithSearchText } from "@/lib/integrations/ai/GeminiClient";

describe("generateSplitFacilityPair", () => {
  test("改札検索と出口検索を並列し、両方取れたら組にする", async () => {
    vi.mocked(searchAndGenerateStructuredContentWithSearchText)
      .mockResolvedValueOnce({
        data: { name: "A1出口", pairedName: "道玄坂改札", confidence: "medium" },
        searchText: "公式構内図に A1出口 と 道玄坂改札 とある",
      })
      .mockResolvedValueOnce({
        data: { name: "道玄坂改札", confidence: "medium" },
        searchText: "道玄坂改札 から A1出口",
      });

    const pair = await generateSplitFacilityPair({
      apiKey: "k",
      stationName: "渋谷駅",
      stationCoordinates: { lat: 35.658, lng: 139.701 },
      destinationHint: "ウエチャベ",
    });
    expect(pair.exit?.name).toBe("A1出口");
    expect(pair.gate?.name).toBe("道玄坂改札");
    expect(pair.paired).toBe(true);
    expect(searchAndGenerateStructuredContentWithSearchText).toHaveBeenCalledTimes(2);
  });

  test("検索テキストに無い名前は捨てる", async () => {
    vi.mocked(searchAndGenerateStructuredContentWithSearchText).mockResolvedValue({
      data: { name: "架空出口", confidence: "high" },
      searchText: "実在する出口の説明だけ",
    });
    const pair = await generateSplitFacilityPair({
      apiKey: "k",
      stationName: "渋谷駅",
      stationCoordinates: null,
      destinationHint: null,
    });
    expect(pair.exit).toBeNull();
    expect(pair.gate).toBeNull();
    expect(pair.paired).toBe(false);
  });

  test("接続名が食い違う改札と出口は paired=false のまま組にしない", async () => {
    vi.mocked(searchAndGenerateStructuredContentWithSearchText)
      .mockResolvedValueOnce({
        data: { name: "A1出口", pairedName: "道玄坂改札", confidence: "medium" },
        searchText: "A1出口 道玄坂改札",
      })
      .mockResolvedValueOnce({
        data: { name: "ヒカリエ改札", pairedName: "B5出口", confidence: "medium" },
        searchText: "ヒカリエ改札 B5出口",
      });
    const pair = await generateSplitFacilityPair({
      apiKey: "k",
      stationName: "渋谷駅",
      stationCoordinates: null,
      destinationHint: "ウエチャベ",
    });
    expect(pair.paired).toBe(false);
    expect(pair.exit?.name).toBe("A1出口");
    expect(pair.gate?.name).toBe("ヒカリエ改札");
  });
});
