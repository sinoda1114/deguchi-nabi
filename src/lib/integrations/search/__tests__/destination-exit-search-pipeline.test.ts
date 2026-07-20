import { afterEach, describe, expect, test, vi } from "vitest";
import { searchDestinationExitViaSerper } from "../destination-exit-search-pipeline";

const serperSearch = vi.fn();
const fetchPageAsMarkdown = vi.fn();
const generateStructuredContent = vi.fn();

vi.mock("../serper-client", () => ({
  serperSearch: (...args: unknown[]) => serperSearch(...args),
}));
vi.mock("../jina-reader-client", () => ({
  fetchPageAsMarkdown: (...args: unknown[]) => fetchPageAsMarkdown(...args),
}));
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  generateStructuredContent: (...args: unknown[]) => generateStructuredContent(...args),
}));

const KEYS = { serperApiKey: "serper", jinaApiKey: "jina", geminiApiKey: "gemini" };

// 公式ドメインではないが、タイトルに関連語(出口)を含みscore>0になる検索結果。
const RESULTS = [
  { title: "ウエチャベ アクセス・出口案内", link: "https://uetyabe.owst.jp/", snippet: "アクセス 出口" },
  { title: "ウエチャベ 出口 ホットペッパー", link: "https://www.hotpepper.jp/strJ003389181/", snippet: "アクセス" },
];

describe("searchDestinationExitViaSerper", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("serper→scoring→jina→抽出のフローが繋がり出口を返す", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("井の頭線西口より徒歩約1分/JR渋谷駅ハチ公口より徒歩約6分");
    generateStructuredContent.mockResolvedValue({
      candidates: [
        { viaHint: "京王井の頭線", exitName: "井の頭線西口", gateName: null },
        { viaHint: "JR", exitName: "ハチ公口", gateName: "ハチ公改札" },
      ],
    });

    const result = await searchDestinationExitViaSerper(
      KEYS,
      "しゃぶしゃぶ×居酒屋 ウエチャベ",
      { lat: 35.6587716, lng: 139.6982764 },
      ["東急東横線"]
    );

    expect(serperSearch).toHaveBeenCalled();
    expect(fetchPageAsMarkdown).toHaveBeenCalled();
    expect(generateStructuredContent).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  test("複数系統の候補がある場合、destinationLinesと一致するviaHintの候補を優先して選ぶ", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [
        { viaHint: "京王井の頭線", exitName: "井の頭線西口", gateName: null },
        { viaHint: "JR", exitName: "ハチ公口", gateName: "ハチ公改札" },
        { viaHint: "東急東横線", exitName: "A0出口", gateName: "道玄坂改札" },
      ],
    });

    const result = await searchDestinationExitViaSerper(
      KEYS,
      "しゃぶしゃぶ×居酒屋 ウエチャベ",
      { lat: 35.6587716, lng: 139.6982764 },
      ["東急東横線", "東京メトロ副都心線"]
    );

    expect(result?.exit.name).toBe("A0出口");
    expect(result?.gateHint).toBe("道玄坂改札");
  });

  test("destinationLinesと一致するviaHintが無い場合は先頭の候補にフォールバックする", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [
        { viaHint: "京王井の頭線", exitName: "井の頭線西口", gateName: null },
        { viaHint: "JR", exitName: "ハチ公口", gateName: "ハチ公改札" },
      ],
    });

    const result = await searchDestinationExitViaSerper(
      KEYS,
      "しゃぶしゃぶ×居酒屋 ウエチャベ",
      { lat: 35.6587716, lng: 139.6982764 },
      ["東急東横線"]
    );

    expect(result?.exit.name).toBe("井の頭線西口");
  });

  test("viaHintが空文字の候補のみの場合(単一系統しか案内していない目的地)はそのまま採用する", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "", exitName: "みなみ西口（相鉄口）", gateName: "相鉄線1階改札" }],
    });

    const result = await searchDestinationExitViaSerper(
      KEYS,
      "kawara CAFE&DINING 横浜店",
      { lat: 35.4640221, lng: 139.6200651 },
      ["相鉄本線"]
    );

    expect(result?.exit.name).toBe("みなみ西口（相鉄口）");
    expect(result?.gateHint).toBe("相鉄線1階改札");
  });

  test("検索結果が0件の場合はnullを返す(フォールバック余地を残す)", async () => {
    serperSearch.mockResolvedValue([]);

    const result = await searchDestinationExitViaSerper(
      KEYS,
      "存在しない施設名",
      null,
      ["相鉄本線"]
    );

    expect(result).toBeNull();
    expect(fetchPageAsMarkdown).not.toHaveBeenCalled();
  });

  test("本文取得が全滅した場合はnullを返す", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue(null);

    const result = await searchDestinationExitViaSerper(
      KEYS,
      "しゃぶしゃぶ×居酒屋 ウエチャベ",
      null,
      ["東急東横線"]
    );

    expect(result).toBeNull();
    expect(generateStructuredContent).not.toHaveBeenCalled();
  });

  test("抽出結果が0件、またはcandidatesが配列でない場合はnullを返す(創作しない)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({ candidates: [] });

    const result = await searchDestinationExitViaSerper(
      KEYS,
      "しゃぶしゃぶ×居酒屋 ウエチャベ",
      null,
      ["東急東横線"]
    );

    expect(result).toBeNull();
  });

  test("generateStructuredContentがnullを返した場合もnullを返す(例外を投げない)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue(null);

    const result = await searchDestinationExitViaSerper(
      KEYS,
      "しゃぶしゃぶ×居酒屋 ウエチャベ",
      null,
      ["東急東横線"]
    );

    expect(result).toBeNull();
  });
});
