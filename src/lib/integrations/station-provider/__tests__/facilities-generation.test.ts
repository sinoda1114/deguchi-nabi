import { afterEach, describe, expect, test, vi } from "vitest";
import { generateStationFacilitiesDispatch } from "../facilities-generation";

const generateStationFacilities = vi.fn();
const searchStationFacilitiesViaPipeline = vi.fn();

vi.mock("../ai-generation", () => ({
  generateStationFacilities: (...args: unknown[]) => generateStationFacilities(...args),
}));
vi.mock("@/lib/integrations/search/facilities-search-pipeline", () => ({
  searchStationFacilitiesViaPipeline: (...args: unknown[]) =>
    searchStationFacilitiesViaPipeline(...args),
}));

describe("generateStationFacilitiesDispatch", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  test("FACILITIES_SEARCH_BACKEND未設定なら既存のgenerateStationFacilitiesを呼ぶ", async () => {
    generateStationFacilities.mockResolvedValue([]);

    await generateStationFacilitiesDispatch("gemini", "渋谷駅", "JR東日本", ["JR山手線"], null, null);

    expect(generateStationFacilities).toHaveBeenCalledTimes(1);
    expect(searchStationFacilitiesViaPipeline).not.toHaveBeenCalled();
  });

  test("FACILITIES_SEARCH_BACKEND=groundingなら既存のgenerateStationFacilitiesを呼ぶ", async () => {
    vi.stubEnv("FACILITIES_SEARCH_BACKEND", "grounding");
    generateStationFacilities.mockResolvedValue([]);

    await generateStationFacilitiesDispatch("gemini", "渋谷駅", "JR東日本", ["JR山手線"], null, null);

    expect(generateStationFacilities).toHaveBeenCalledTimes(1);
    expect(searchStationFacilitiesViaPipeline).not.toHaveBeenCalled();
  });

  test("FACILITIES_SEARCH_BACKEND=serper かつ SERPER_API_KEY有ならパイプラインを呼ぶ", async () => {
    vi.stubEnv("FACILITIES_SEARCH_BACKEND", "serper");
    vi.stubEnv("SERPER_API_KEY", "serper-key");
    vi.stubEnv("JINA_API_KEY", "jina-key");
    searchStationFacilitiesViaPipeline.mockResolvedValue([]);

    await generateStationFacilitiesDispatch(
      "gemini",
      "渋谷駅",
      "JR東日本",
      ["JR山手線"],
      { lat: 35.658, lng: 139.7016 },
      null
    );

    expect(searchStationFacilitiesViaPipeline).toHaveBeenCalledTimes(1);
    expect(generateStationFacilities).not.toHaveBeenCalled();
    const call = searchStationFacilitiesViaPipeline.mock.calls[0];
    expect(call[0]).toEqual({
      serperApiKey: "serper-key",
      jinaApiKey: "jina-key",
      geminiApiKey: "gemini",
    });
  });

  test("serper指定でもSERPER_API_KEY未設定ならgroundingにフォールバック(console.warn)", async () => {
    vi.stubEnv("FACILITIES_SEARCH_BACKEND", "serper");
    // SERPER_API_KEY は未設定
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateStationFacilities.mockResolvedValue([]);

    await generateStationFacilitiesDispatch("gemini", "渋谷駅", "JR東日本", ["JR山手線"], null, null);

    expect(generateStationFacilities).toHaveBeenCalledTimes(1);
    expect(searchStationFacilitiesViaPipeline).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("JINA_API_KEY未設定でもパイプラインにjinaApiKey:nullで渡す", async () => {
    vi.stubEnv("FACILITIES_SEARCH_BACKEND", "serper");
    vi.stubEnv("SERPER_API_KEY", "serper-key");
    // JINA_API_KEY は未設定
    searchStationFacilitiesViaPipeline.mockResolvedValue([]);

    await generateStationFacilitiesDispatch("gemini", "渋谷駅", "JR東日本", ["JR山手線"], null, null);

    const call = searchStationFacilitiesViaPipeline.mock.calls[0];
    expect(call[0].jinaApiKey).toBeNull();
  });
});
