import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildNavigatorSearchPrompt,
  buildSharedGuideCacheKey,
  generateSingleCallNavigatorGuide,
  getSharedSingleCallNavigatorGuide,
} from "../single-call-navigator";
import type { Station } from "@/lib/domain/station";

const searchAndGenerateStructuredContent = vi.fn();
vi.mock("@/lib/integrations/ai/GeminiClient", () => ({
  searchAndGenerateStructuredContent: (...args: unknown[]) =>
    searchAndGenerateStructuredContent(...args),
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

const VALID_RAW = {
  lines: ["相鉄・東急直通線"],
  transferCount: 0,
  estimatedMinutes: 35,
  gate: { name: "道玄坂改札", confidence: "medium" },
  exit: { name: "A1出口", confidence: "medium" },
  boardingCarNumber: 5,
  boardingDoorPosition: "1番ドア",
  boardingReason: "階段が近いため",
  boardingConfidence: "low",
  walkingSteps: [{ title: "道玄坂を上る", instruction: "A1出口を出て道玄坂を上ってください。", confidence: "medium" }],
};

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
});

describe("generateSingleCallNavigatorGuide", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("正常な抽出結果からguideを組み立てる", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue(VALID_RAW);

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");

    expect(result).not.toBeNull();
    expect(result?.lines).toEqual(["相鉄・東急直通線"]);
    expect(result?.gate).toEqual({ name: "道玄坂改札", confidenceLevel: "medium" });
    expect(result?.exit).toEqual({ name: "A1出口", confidenceLevel: "medium" });
    expect(result?.boarding).toEqual({
      carNumber: 5,
      doorPosition: "1番ドア",
      reason: "階段が近いため",
      confidenceLevel: "low",
    });
    expect(result?.walkingSteps).toHaveLength(1);
  });

  test("号車が未確認(boardingCarNumber省略)の場合、boardingはnullになる(断定を避ける挙動の維持)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["相鉄・東急直通線"],
      transferCount: 0,
      estimatedMinutes: 35,
      gateName: "道玄坂改札",
      gateConfidence: "medium",
      exitName: "A1出口",
      exitConfidence: "medium",
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.boarding).toBeNull();
  });

  test("改札・出口が未確認(gate/exit省略)の場合はnullのまま(創作しない)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["相鉄・東急直通線"],
      transferCount: 0,
      estimatedMinutes: 35,
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.gate).toBeNull();
    expect(result?.exit).toBeNull();
    expect(result?.walkingSteps).toEqual([]);
  });

  test("改札名は明記されているがconfidenceだけ欠けている場合、棄却せずlowで採用する(本番再現バグの回帰テスト: 西谷駅→kawara CAFE&DINING横浜店でgateNameは取れていたのにgateConfidence欠落で丸ごとnullになっていた)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["相鉄本線"],
      transferCount: 0,
      estimatedMinutes: 13,
      gate: { name: "1階改札（みなみ西口（相鉄口）側）" },
      walkingSteps: [],
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.gate).toEqual({
      name: "1階改札（みなみ西口（相鉄口）側）",
      confidenceLevel: "low",
    });
  });

  test("gate/exitオブジェクト自体が不正な型(null以外の非オブジェクト)の場合はnullとして扱う", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["相鉄・東急直通線"],
      transferCount: 0,
      estimatedMinutes: 35,
      gate: "道玄坂改札",
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.gate).toBeNull();
  });

  test("路線名に縮退生成の反復パターンが含まれる場合は無効として扱い、最終的にnullを返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      ...VALID_RAW,
      lines: ["瘉鉄改戳版最改版甘鉄改戳版最改版・瘉鉄改戳版最改版甘鉄改戳版最改版"],
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result).toBeNull();
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(2);
  });

  test("改札名に異常に長い文字列が来た場合は採用しない(セキュリティ: 後段プロンプトへの汚染防止)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      ...VALID_RAW,
      gate: { name: "あ".repeat(200), confidence: "medium" },
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.gate).toBeNull();
  });

  test("号車が実在する編成両数の上限(16)を超える場合は採用しない(/ai-review指摘)", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      ...VALID_RAW,
      boardingCarNumber: 99,
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.boarding).toBeNull();
  });

  test("号車が上限(16)ちょうどの場合は採用する", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      ...VALID_RAW,
      boardingCarNumber: 16,
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result?.boarding?.carNumber).toBe(16);
  });

  test("1回目がnull・2回目が正常な場合、リトライして2回目の結果を返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValueOnce(null).mockResolvedValueOnce(VALID_RAW);

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result).not.toBeNull();
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(2);
  });

  test("2回ともnullの場合、最終的にnullを返し3回目は試行しない", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue(null);

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(result).toBeNull();
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(2);
  });

  test("改札・出口が両方とも未確認(gate/exitともnull)の場合も再試行する(本番実機で発覚した不具合の回帰テスト)", async () => {
    searchAndGenerateStructuredContent
      .mockResolvedValueOnce({
        lines: ["相鉄本線"],
        transferCount: 0,
        estimatedMinutes: 13,
        walkingSteps: [],
      })
      .mockResolvedValueOnce(VALID_RAW);

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(2);
    expect(result?.gate).toEqual({ name: "道玄坂改札", confidenceLevel: "medium" });
  });

  test("再試行しても改札・出口が両方未確認のままの場合、経路情報は捨てず直近の結果を返す", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue({
      lines: ["相鉄本線"],
      transferCount: 0,
      estimatedMinutes: 13,
      walkingSteps: [],
    });

    const result = await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result?.lines).toEqual(["相鉄本線"]);
    expect(result?.gate).toBeNull();
    expect(result?.exit).toBeNull();
  });

  test("1回目で正常な結果が返る場合、2回目(リトライ)は呼ばれない", async () => {
    searchAndGenerateStructuredContent.mockResolvedValue(VALID_RAW);

    await generateSingleCallNavigatorGuide("key", NISHIYA, SHIBUYA, "ウエチャベ");
    expect(searchAndGenerateStructuredContent).toHaveBeenCalledTimes(1);
  });
});

describe("getSharedSingleCallNavigatorGuide", () => {
  test("同じキーで短時間内に呼ばれた場合、generatorは1回しか実行されない(2重課金防止)", async () => {
    const generator = vi.fn().mockResolvedValue(null);
    const key = buildSharedGuideCacheKey("st_nishiya", "st_shibuya", "ウエチャベ");

    await getSharedSingleCallNavigatorGuide(key, generator);
    await getSharedSingleCallNavigatorGuide(key, generator);

    expect(generator).toHaveBeenCalledTimes(1);
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
