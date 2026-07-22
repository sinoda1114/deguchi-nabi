import type { Confidence, Provenance } from "./confidence";

/**
 * 改札・出口を「確証なしなら丸ごと非表示」の全か無かゲートで扱うのをやめ、
 * 単一断定(confirmed)・複数候補(alternatives)・不明(unavailable)の3状態で
 * 表現する(2026-07-22、Fable 5・Codexの独立レビューで一致した結論)。
 *
 * 背景: 検索結果テキストに「利用する出口: A または B」のように、2択には
 * 絞れているが1つに断定できない情報が含まれることがある。従来の「断定
 * できなければnull」ルールでは、これが丸ごと捨てられunavailable扱いに
 * なっていた。これは既存の設計原則「存在する情報は必ず出す、隠さない」に
 * 反するため、alternatives状態を新設してこの情報を残す。
 */
export interface NamedFacility {
  name: string;
  confidence: Confidence;
  /**
   * 出所(現地調査済み/地図で確認/AI推定)。GuideStep生成時にconfidenceの上限を
   * 決めるために使う(StationFacility.provenanceと同じ役割・同じ既定値の
   * 考え方: 省略時は最も慎重な"ai_inferred"として扱う)。単一呼び出し方式
   * (AI生成)由来のfacilityは常に"ai_inferred"を明示的に持つ。
   */
  provenance?: Provenance;
}

/**
 * 改札と出口を必ず「組」として保持する。gate用/exit用に別々の候補配列を
 * 持つと、実在するが対応していない組合せ(改札A×出口Y)をUIやロジックが
 * 誤って組み立ててしまう再発経路になる(過去に「実在するが目的地に不適切な
 * 改札を案内した」事故があった)。この型はその再発防止のガードレール。
 * gate・exitの少なくとも一方は非nullであること(classifyFacilityRecommendation
 * が空pairを除外する)。
 *
 * confidenceの型を型引数Fにしているのは、生成層(single-call-navigator.ts)が
 * 自己申告のConfidenceLevel(生の文字列)しか持たず、それを検証度Confidence
 * オブジェクト(reasons/verifiedAt等を含む)へ変換するのはAiStationAdapter層の
 * 責務(groundedAiConfidence)だから。同じ組・3状態判定ロジックを両層で
 * 再利用するため、確定した具象型(NamedFacility)をデフォルト値にしつつ、
 * 生成層は自前の生の型を渡せるようにしている。F extends { name: string } は
 * 重複排除(dedupePairs/dedupeByName)がnameを比較キーに使うための制約。
 */
export interface FacilityPair<F extends { name: string } = NamedFacility> {
  gate: F | null;
  exit: F | null;
  /** この組を選んだ理由(任意)。confirmed状態の案内文言に使う。 */
  reason: string | null;
}

export type FacilityRecommendation<F extends { name: string } = NamedFacility> =
  | { state: "confirmed"; pair: FacilityPair<F> }
  | { state: "alternatives"; pairs: FacilityPair<F>[] }
  | { state: "unavailable"; reason: string };

/**
 * 候補が多すぎる(絞り込めていない)場合はunavailableへ格下げする閾値。
 * 3件までは「複数の妥当な選択肢」として提示できるが、4件以上は情報源が
 * 弱く実質的に絞り込めていないとみなす。
 */
const MAX_ALTERNATIVES = 3;

function pairKey<F extends { name: string }>(pair: FacilityPair<F>): string {
  return `${pair.gate?.name ?? ""}::${pair.exit?.name ?? ""}`;
}

/**
 * gate名・exit名の組が完全に一致するpairを重複排除する(/ai-review指摘、
 * Codex: モデルが同一候補を配列内で2回返しただけで、実際には1択なのに
 * alternatives(複数候補)と誤判定されてしまう問題への対応)。
 */
function dedupePairs<F extends { name: string }>(pairs: FacilityPair<F>[]): FacilityPair<F>[] {
  const seen = new Set<string>();
  const result: FacilityPair<F>[] = [];
  for (const pair of pairs) {
    const key = pairKey(pair);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(pair);
  }
  return result;
}

/**
 * pair配列から3状態を判定する。gate・exitともにnullのpair(抽出時に
 * 逐語一致検証で両方棄却された等)は無効として除外し、さらに完全一致する
 * 重複pairを除いてから件数判定する(dedupePairs参照)。
 */
export function classifyFacilityRecommendation<F extends { name: string }>(
  pairs: FacilityPair<F>[]
): FacilityRecommendation<F> {
  const validPairs = dedupePairs(pairs.filter((pair) => pair.gate !== null || pair.exit !== null));

  if (validPairs.length === 0) {
    return { state: "unavailable", reason: "改札・出口の情報が確認できませんでした" };
  }
  if (validPairs.length === 1) {
    return { state: "confirmed", pair: validPairs[0] };
  }
  if (validPairs.length > MAX_ALTERNATIVES) {
    return { state: "unavailable", reason: "候補が多すぎて絞り込めませんでした" };
  }
  return { state: "alternatives", pairs: validPairs };
}

function dedupeByName<F extends { name: string }>(facilities: F[]): F[] {
  const seen = new Set<string>();
  const result: F[] = [];
  for (const facility of facilities) {
    if (seen.has(facility.name)) continue;
    seen.add(facility.name);
    result.push(facility);
  }
  return result;
}

/**
 * 3状態から、実際に案内可能な施設(NamedFacility等)の配列を取り出す共有処理。
 * confirmedなら0〜1件、alternativesなら2〜3件、unavailableなら0件になる。
 * route-search.ts(セグメント・サマリー組み立て)・arrival-guide.ts(GuideStep
 * 組み立て)の両方から、gate/exitそれぞれに対して同じロジックで使う。
 *
 * 名前で重複排除する(/ai-review指摘、Codex: 「改札A+出口X」「改札A+出口Y」の
 * ように出口だけ異なる2つのpairがある場合、gate側だけを取り出すと同じ改札名が
 * 2件並び、UIに「改札A / 改札A」のように誤って複数候補表示されてしまう問題
 * への対応。gate自体は実質1択なので、名前基準で1件にまとめる)。
 */
export function facilityCandidatesOf<F extends { name: string }>(
  recommendation: FacilityRecommendation<F>,
  pick: (pair: FacilityPair<F>) => F | null
): F[] {
  if (recommendation.state === "confirmed") {
    const facility = pick(recommendation.pair);
    return facility ? [facility] : [];
  }
  if (recommendation.state === "alternatives") {
    const facilities = recommendation.pairs
      .map(pick)
      .filter((facility): facility is F => facility !== null);
    return dedupeByName(facilities);
  }
  return [];
}

/**
 * 抽出された施設名が、検索フェーズの生テキストに逐語で存在するかを検証する
 * (事故再発防止のガードレール: AIによる補完・正規化での候補追加を機械的に
 * 拒否する)。正規化は前後空白のトリムのみに留める。全角/半角統一等の
 * 積極的な正規化は行わない(「創作・正規化での追加禁止」という制約自体を
 * 弱めてしまうため)。
 */
export function isVerbatimInSearchText(name: string, searchText: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  return searchText.includes(trimmed);
}
