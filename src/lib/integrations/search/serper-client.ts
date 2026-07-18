/**
 * Serper(google.serper.dev、Google検索のAPIラッパー)の薄いクライアント。
 * 改札・出口AI生成の Serper 検索パイプライン(facilities-search-pipeline.ts)から
 * 公式サイト候補を集めるために使う。
 *
 * ネットワーク障害・タイムアウト・非200・不正な応答は全て空配列を返す
 * (例外を投げない)。検索は補助的な情報収集であり、その障害でルート検索全体を
 * 落としてはならないため(GeminiClient と同じ設計方針)。
 */

const SEARCH_URL = "https://google.serper.dev/search";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_NUM = 10;

export interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  /** Serperが推定した発行日(取得できない場合は省略される)。 */
  date?: string;
}

interface SerperOrganicItem {
  title?: unknown;
  link?: unknown;
  snippet?: unknown;
  date?: unknown;
}

interface SerperResponse {
  organic?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * organic配列の1件を SerperSearchResult へ正規化する。link/title が無い項目は
 * 検索結果として使えないため null を返して呼び出し側で除外する。
 */
function toSearchResult(item: SerperOrganicItem): SerperSearchResult | null {
  if (!isNonEmptyString(item.link) || !isNonEmptyString(item.title)) return null;
  return {
    title: item.title,
    link: item.link,
    snippet: typeof item.snippet === "string" ? item.snippet : "",
    ...(isNonEmptyString(item.date) ? { date: item.date } : {}),
  };
}

export async function serperSearch(
  apiKey: string,
  query: string,
  opts?: { num?: number }
): Promise<SerperSearchResult[]> {
  try {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        gl: "jp",
        hl: "ja",
        num: opts?.num ?? DEFAULT_NUM,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as SerperResponse;
    if (!Array.isArray(data.organic)) return [];

    return data.organic
      .map((item) => toSearchResult(item as SerperOrganicItem))
      .filter((item): item is SerperSearchResult => item !== null);
  } catch {
    return [];
  }
}
