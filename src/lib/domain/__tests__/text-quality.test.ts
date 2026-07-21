import { describe, expect, test } from "vitest";
import { hasRepetitionArtifact } from "@/lib/domain/text-quality";

describe("hasRepetitionArtifact", () => {
  test("実機検証で観測した縮退生成の文字化け文字列はtrueを返す(回帰テスト)", () => {
    const degenerate =
      "瘉鉄改戳版最改版甘鉄改戳版最改版・瘉鉄改戳版最改版甘鉄改戳版最改版";
    expect(hasRepetitionArtifact(degenerate)).toBe(true);
  });

  test.each([
    "相鉄本線",
    "東急東横線",
    "京王井の頭線",
    "みなとみらい線",
    "湘南新宿ライン",
    "つくばエクスプレス",
    "相鉄新横浜線・東急東横線",
  ])("正当な路線名 %s はfalseを返す(誤検知しない)", (lineName) => {
    expect(hasRepetitionArtifact(lineName)).toBe(false);
  });

  test.each(["本線", "線", "JR", ""])(
    "短い文字列 %s は判定自体が意味を持たないためfalseを返す",
    (text) => {
      expect(hasRepetitionArtifact(text)).toBe(false);
    }
  );

  test("意図的な単純な繰り返し('ああああああああ')はtrueを返す(特定パターンへのハードコードではない汎用検出)", () => {
    expect(hasRepetitionArtifact("ああああああああ")).toBe(true);
  });

  test("minSubstringLengthを指定すると、それより短い部分文字列の反復では検出しない", () => {
    // "あいあい" は2文字の反復("あい"が2回)だが、デフォルトの4文字部分文字列としては
    // "あいあい"自体しか存在せず(長さ4ちょうど)反復にならない
    expect(hasRepetitionArtifact("あいあい")).toBe(false);
    expect(hasRepetitionArtifact("あいあい", 2)).toBe(true);
  });
});
