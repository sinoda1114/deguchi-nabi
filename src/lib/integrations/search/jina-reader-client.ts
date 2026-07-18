/**
 * Jina Reader(r.jina.ai、任意のWebページ→Markdown本文に変換する無料サービス)の
 * 薄いクライアント。Serper 検索パイプライン(facilities-search-pipeline.ts)が
 * 採用した公式サイトURLの本文を取得し、Gemini抽出段に渡すために使う。
 *
 * apiKey(JINA_API_KEY)は任意。設定するとレート制限が緩くなる。
 * ネットワーク障害・タイムアウト・非200は null を返す(例外を投げない)。
 */

const READER_BASE_URL = "https://r.jina.ai/";
const REQUEST_TIMEOUT_MS = 20_000;
/** LLMへ渡すコンテキスト量・コストを抑えるため、本文はこの文字数で打ち切る。 */
const MAX_CONTENT_LENGTH = 8_000;

export async function fetchPageAsMarkdown(
  apiKey: string | null,
  url: string
): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      "X-Return-Format": "markdown",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${READER_BASE_URL}${url}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const text = await res.text();
    return text.slice(0, MAX_CONTENT_LENGTH);
  } catch {
    return null;
  }
}
