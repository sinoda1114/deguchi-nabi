/**
 * 駅構内図の画像を検索・取得するオーケストレーター。
 * Vision統合Grounding(vision-grounding.ts)から呼ばれる。
 *
 * Serperの画像検索で候補URLを集め、取得可能(HTTP到達性・Content-Type・
 * サイズ上限を満たす)な最初の1枚を採用する。JR東日本のような大手鉄道会社の
 * 公式サイトはAkamai等のbot対策で直接取得できないことがあるため
 * (PoCで確認済み)、複数候補への有界フォールバックで対応する — ただし
 * 無制限に試行し続けるとレイテンシ・コストが膨らむため、試行数に上限を設ける
 * (council決定: AIエージェント的な無制限ループは導入しない)。
 */

import { serperImageSearch, type SerperImageResult } from "./serper-image-search-client";
import { fetchImageAsInlineData, type FetchedImage } from "./station-image-fetch";

/** 取得を試みる画像候補の上限。無制限フォールバックを避けるための固定値。 */
const MAX_CANDIDATES_TO_TRY = 5;

/**
 * 事業者名を検索クエリに含める(Codexのセカンドオピニオン指摘)。駅名だけだと
 * 同名の別駅や古い構内図が混入しうるため、事業者名で絞り込む。
 */
function buildQuery(stationName: string, operator: string): string {
  return operator ? `${stationName} ${operator} 構内図` : `${stationName} 構内図`;
}

/**
 * titleに駅名を含む候補を先頭へ寄せる(/ai-review指摘、Low)。Serperの画像
 * 検索結果には駅弁・グルメ記事等の無関係な画像が混ざることがあり、それが
 * 先頭に来ると誤った画像がGeminiの「最優先の情報源」として使われてしまう
 * リスクがある。ただし完全な正確性判定は困難なため、除外はせず優先度を
 * 上げるだけに留める(該当が無ければ元の順序のまま全候補を試行する)。
 */
function prioritizeByTitleMatch(
  candidates: SerperImageResult[],
  stationName: string
): SerperImageResult[] {
  const matched = candidates.filter((c) => c.title.includes(stationName));
  const rest = candidates.filter((c) => !c.title.includes(stationName));
  return [...matched, ...rest];
}

export async function findStationFloorMapImage(
  serperApiKey: string,
  stationName: string,
  operator: string
): Promise<FetchedImage | null> {
  const candidates = await serperImageSearch(serperApiKey, buildQuery(stationName, operator));
  if (candidates.length === 0) return null;

  const prioritized = prioritizeByTitleMatch(candidates, stationName);

  for (const candidate of prioritized.slice(0, MAX_CANDIDATES_TO_TRY)) {
    const fetched = await fetchImageAsInlineData(candidate.imageUrl);
    if (fetched) return fetched;
  }

  return null;
}
