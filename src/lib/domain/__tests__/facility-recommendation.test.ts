import { describe, expect, test } from "vitest";
import {
  classifyFacilityRecommendation,
  facilityCandidatesOf,
  isVerbatimInSearchText,
} from "@/lib/domain/facility-recommendation";
import type { FacilityPair, NamedFacility } from "@/lib/domain/facility-recommendation";
import { lowConfidence } from "@/lib/domain/confidence";

function namedFacility(name: string): NamedFacility {
  return { name, confidence: lowConfidence("test") };
}

function pair(gateName: string | null, exitName: string | null): FacilityPair {
  return {
    gate: gateName ? namedFacility(gateName) : null,
    exit: exitName ? namedFacility(exitName) : null,
    reason: null,
  };
}

describe("classifyFacilityRecommendation", () => {
  test("有効なpairが0件ならunavailable", () => {
    const result = classifyFacilityRecommendation([]);
    expect(result.state).toBe("unavailable");
  });

  test("gate・exitともにnullのpairのみの場合もunavailable(無効pairとして除外)", () => {
    const result = classifyFacilityRecommendation([pair(null, null)]);
    expect(result.state).toBe("unavailable");
  });

  test("有効なpairが1件ならconfirmed", () => {
    const result = classifyFacilityRecommendation([pair("1階改札", "みなみ西口")]);
    expect(result.state).toBe("confirmed");
    if (result.state === "confirmed") {
      expect(result.pair.gate?.name).toBe("1階改札");
      expect(result.pair.exit?.name).toBe("みなみ西口");
    }
  });

  test("gate/exitの片方だけのpairでもconfirmedになる(片方確認できたケースの維持)", () => {
    const result = classifyFacilityRecommendation([pair("1階改札", null)]);
    expect(result.state).toBe("confirmed");
    if (result.state === "confirmed") {
      expect(result.pair.gate?.name).toBe("1階改札");
      expect(result.pair.exit).toBeNull();
    }
  });

  test("有効なpairが2件ならalternatives", () => {
    const result = classifyFacilityRecommendation([
      pair("1階改札", "みなみ西口"),
      pair("5番街改札", "5番街方面出口"),
    ]);
    expect(result.state).toBe("alternatives");
    if (result.state === "alternatives") {
      expect(result.pairs).toHaveLength(2);
    }
  });

  test("有効なpairが3件ならalternatives(境界: 3件は許容)", () => {
    const result = classifyFacilityRecommendation([
      pair("A改札", "A出口"),
      pair("B改札", "B出口"),
      pair("C改札", "C出口"),
    ]);
    expect(result.state).toBe("alternatives");
  });

  test("有効なpairが4件ならunavailable(境界: 4件以上は絞り込めていないとみなす)", () => {
    const result = classifyFacilityRecommendation([
      pair("A改札", "A出口"),
      pair("B改札", "B出口"),
      pair("C改札", "C出口"),
      pair("D改札", "D出口"),
    ]);
    expect(result.state).toBe("unavailable");
  });

  test("無効pair(gate/exit両方null)は件数カウントから除外される", () => {
    const result = classifyFacilityRecommendation([
      pair("1階改札", "みなみ西口"),
      pair(null, null),
    ]);
    expect(result.state).toBe("confirmed");
  });

  test("gate名・exit名が完全一致する重複pairは1件にまとめられconfirmedになる(/ai-review指摘、Codex: モデルが同一候補を2回返しただけでalternatives誤判定される問題)", () => {
    const result = classifyFacilityRecommendation([
      pair("1階改札", "みなみ西口"),
      pair("1階改札", "みなみ西口"),
    ]);
    expect(result.state).toBe("confirmed");
  });

  test("gateは同じでexitだけ異なるpairは重複排除されずalternativesのまま(出口は本当に複数候補)", () => {
    const result = classifyFacilityRecommendation([
      pair("1階改札", "みなみ西口"),
      pair("1階改札", "5番街方面出口"),
    ]);
    expect(result.state).toBe("alternatives");
    if (result.state === "alternatives") {
      expect(result.pairs).toHaveLength(2);
    }
  });
});

describe("facilityCandidatesOf", () => {
  test("alternatives状態でgateの名前が全pairで同じ場合、重複排除して1件だけ返す(/ai-review指摘、Codex: 「改札A+出口X」「改札A+出口Y」でgate側を取り出すと「改札A / 改札A」と誤って複数候補表示されてしまう問題)", () => {
    const recommendation = classifyFacilityRecommendation([
      pair("1階改札", "みなみ西口"),
      pair("1階改札", "5番街方面出口"),
    ]);
    const gates = facilityCandidatesOf(recommendation, (p) => p.gate);
    expect(gates).toHaveLength(1);
    expect(gates[0].name).toBe("1階改札");
  });

  test("alternatives状態でexitの名前がpairごとに異なる場合、重複排除せず全件返す", () => {
    const recommendation = classifyFacilityRecommendation([
      pair("1階改札", "みなみ西口"),
      pair("1階改札", "5番街方面出口"),
    ]);
    const exits = facilityCandidatesOf(recommendation, (p) => p.exit);
    expect(exits).toHaveLength(2);
    expect(exits.map((e) => e.name)).toEqual(["みなみ西口", "5番街方面出口"]);
  });

  test("confirmed状態なら1件、unavailable状態なら0件を返す", () => {
    const confirmed = classifyFacilityRecommendation([pair("1階改札", "みなみ西口")]);
    expect(facilityCandidatesOf(confirmed, (p) => p.gate)).toHaveLength(1);

    const unavailable = classifyFacilityRecommendation([]);
    expect(facilityCandidatesOf(unavailable, (p) => p.gate)).toHaveLength(0);
  });
});

describe("isVerbatimInSearchText", () => {
  const searchText = "降りる改札: 相鉄線 1階改札口\n利用する出口: みなみ西口(相鉄口)";

  test("検索テキストに逐語で存在する名称はtrue", () => {
    expect(isVerbatimInSearchText("1階改札口", searchText)).toBe(true);
    expect(isVerbatimInSearchText("みなみ西口(相鉄口)", searchText)).toBe(true);
  });

  test("検索テキストに存在しない名称はfalse(創作・補完の拒否)", () => {
    expect(isVerbatimInSearchText("北改札", searchText)).toBe(false);
  });

  test("前後の空白はトリムして比較する", () => {
    expect(isVerbatimInSearchText("  1階改札口  ", searchText)).toBe(true);
  });

  test("空文字はfalse", () => {
    expect(isVerbatimInSearchText("", searchText)).toBe(false);
    expect(isVerbatimInSearchText("   ", searchText)).toBe(false);
  });

  test("全角/半角の違いは正規化しない(過度な正規化による誤許可を避ける、意図的な仕様)", () => {
    expect(isVerbatimInSearchText("1階改札口", "降りる改札: １階改札口")).toBe(false);
  });
});
