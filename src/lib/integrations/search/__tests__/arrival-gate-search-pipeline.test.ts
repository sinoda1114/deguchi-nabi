import { afterEach, describe, expect, test, vi } from "vitest";
import { searchArrivalGateForLine } from "../arrival-gate-search-pipeline";

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

// 駅ガイド系記事(渋谷駅の改札を解説する第三者サイト)を想定した検索結果。
const RESULTS = [
  { title: "渋谷駅の道玄坂改札はどこ？アクセスガイド", link: "https://example-guide.com/shibuya-gate", snippet: "改札 道玄坂" },
  { title: "渋谷駅構内図まとめ", link: "https://another-guide.example.jp/shibuya", snippet: "改札 出口" },
];

describe("searchArrivalGateForLine", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("serper→scoring→jina→抽出のフローが繋がりgate+exitHintを返す", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue(
      "東横線・副都心線からは「道玄坂改札」を出て「A０出口」へ向かうのが最適です。"
    );
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "東急東横線", gateName: "道玄坂改札", exitHint: "A0出口" }],
    });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(serperSearch).toHaveBeenCalled();
    expect(fetchPageAsMarkdown).toHaveBeenCalled();
    expect(generateStructuredContent).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result?.gate.name).toBe("道玄坂改札");
    expect(result?.exitHint).toBe("A0出口");
  });

  test("exitHintが異常に長い(200文字超)候補は無効として除外される(/security-review指摘の回帰テスト)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [
        { viaHint: "東急東横線", gateName: "異常に長いexitHint", exitHint: "あ".repeat(201) },
      ],
    });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(result).toBeNull();
  });

  test("exitHintが空文字の候補は無効として除外される", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "東急東横線", gateName: "空文字exitHint", exitHint: "" }],
    });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(result).toBeNull();
  });

  test("URLスコアリングにtreatNonAggregatorAsLikelyOfficialを渡さない(destination-exit-search-pipeline.tsとは異なり、駅の一般情報検索のため目的地公式サイト向けヒューリスティックは不要)", async () => {
    // scoreSearchSourceの実装は差し替えず、公式ドメインでもアグリゲーターでも
    // ない一般ブログ的URLがscore>0になるかどうかで間接的に検証する。
    // ここでは検索結果自体が候補として拾われる(=score>0でJina取得まで進む)ことを確認する。
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "東急東横線", gateName: "道玄坂改札", exitHint: null }],
    });

    await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(fetchPageAsMarkdown).toHaveBeenCalled();
  });

  test("複数系統の候補がある場合、originLineと一致するviaHintの候補が正しく選ばれる", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [
        { viaHint: "JR", gateName: "ハチ公改札", exitHint: "ハチ公口" },
        { viaHint: "京王井の頭線", gateName: "井の頭線改札", exitHint: "井の頭線西口" },
        { viaHint: "東急東横線", gateName: "道玄坂改札", exitHint: "A0出口" },
      ],
    });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(result?.gate.name).toBe("道玄坂改札");
    expect(result?.exitHint).toBe("A0出口");
  });

  test("路線が一致する候補が無い場合、先頭候補へフォールバックせずnullを返す(destination-exit-search-pipeline.tsとの重要な違い。実機確認: 道玄坂改札×井の頭線西口のような矛盾する組み合わせの再発防止)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [
        { viaHint: "JR", gateName: "ハチ公改札", exitHint: "ハチ公口" },
        { viaHint: "京王井の頭線", gateName: "井の頭線改札", exitHint: "井の頭線西口" },
      ],
    });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    // MAX_ATTEMPTS=2回試行されるが、いずれも不一致のためnullのまま。
    expect(result).toBeNull();
  });

  test("路線名の表記ゆれ(「相鉄本線」と「相鉄線」)を正規化して一致させる", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "相鉄線", gateName: "相鉄線1階改札", exitHint: "みなみ西口" }],
    });

    const result = await searchArrivalGateForLine(KEYS, "横浜駅", "相鉄本線");

    expect(result?.gate.name).toBe("相鉄線1階改札");
    expect(result?.exitHint).toBe("みなみ西口");
  });

  test("viaHintが空文字の候補しかない場合は一致確認できないためnullを返す(originLineが空文字の候補と誤って一致しない設計の裏返し)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "", gateName: "中央改札", exitHint: "東口" }],
    });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(result).toBeNull();
  });

  test("originLineが空文字の場合は一致判定自体を行わずnullを返す(空文字が全候補に誤って一致する潜在バグの防止)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "東急東横線", gateName: "道玄坂改札", exitHint: "A0出口" }],
    });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "");

    expect(result).toBeNull();
  });

  test("検索結果が0件の場合はnullを返す", async () => {
    serperSearch.mockResolvedValue([]);

    const result = await searchArrivalGateForLine(KEYS, "存在しない駅", "テスト線");

    expect(result).toBeNull();
    expect(fetchPageAsMarkdown).not.toHaveBeenCalled();
  });

  test("本文取得が全滅した場合はnullを返す", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue(null);

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(result).toBeNull();
    expect(generateStructuredContent).not.toHaveBeenCalled();
  });

  test("抽出結果が0件、またはcandidatesが配列でない場合はnullを返す(創作しない)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({ candidates: [] });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(result).toBeNull();
  });

  test("generateStructuredContentがnullを返した場合もnullを返す(例外を投げない)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue(null);

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(result).toBeNull();
  });

  test("1回目の本文取得が全滅してnull相当になっても、2回目が成功すれば結果を返す(丸ごと再試行)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "相鉄線", gateName: "相鉄線1階改札", exitHint: null }],
    });

    const result = await searchArrivalGateForLine(KEYS, "横浜駅", "相鉄本線");

    expect(result).not.toBeNull();
    expect(result?.gate.name).toBe("相鉄線1階改札");
    // serperSearchはquery2件×2試行=4回、fetchPageAsMarkdownはadopted件数(RESULTS2件)×2試行=4回呼ばれる想定。
    expect(serperSearch).toHaveBeenCalledTimes(4);
  });

  test("2回とも失敗する場合は最終的にnullを返し、3回目は試行しない", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue(null);

    const result = await searchArrivalGateForLine(KEYS, "横浜駅", "相鉄本線");

    expect(result).toBeNull();
    // MAX_ATTEMPTS=2回分のみ試行される(query2件×2試行=4回で頭打ち、3回目=5回目以降は呼ばれない)。
    expect(serperSearch).toHaveBeenCalledTimes(4);
    expect(generateStructuredContent).not.toHaveBeenCalled();
  });

  test("1回目で成功する場合は2回目(リトライ)を呼ばない(無駄なAPI呼び出しをしない)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "相鉄線", gateName: "相鉄線1階改札", exitHint: null }],
    });

    const result = await searchArrivalGateForLine(KEYS, "横浜駅", "相鉄本線");

    expect(result?.gate.name).toBe("相鉄線1階改札");
    // query2件のみ(=1試行分)。リトライされていれば4回になるはず。
    expect(serperSearch).toHaveBeenCalledTimes(2);
    expect(generateStructuredContent).toHaveBeenCalledTimes(1);
  });

  test("路線不一致で1回目null、2回目も不一致でnullの場合、フォールバックせず最終的にnullを返す(不一致は再試行しても解消しない性質の確認)", async () => {
    serperSearch.mockResolvedValue(RESULTS);
    fetchPageAsMarkdown.mockResolvedValue("本文");
    generateStructuredContent.mockResolvedValue({
      candidates: [{ viaHint: "JR", gateName: "ハチ公改札", exitHint: "ハチ公口" }],
    });

    const result = await searchArrivalGateForLine(KEYS, "渋谷駅", "東急東横線");

    expect(result).toBeNull();
    expect(serperSearch).toHaveBeenCalledTimes(4);
    expect(generateStructuredContent).toHaveBeenCalledTimes(2);
  });
});
