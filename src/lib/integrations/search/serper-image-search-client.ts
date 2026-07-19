/**
 * Serper(google.serper.dev)の画像検索APIの薄いクライアント。
 * 改札・出口AI生成のVision統合(vision-grounding.ts)で、駅構内図の画像候補を
 * 探すために使う。
 *
 * ネットワーク障害・タイムアウト・非200・不正な応答は全て空配列を返す
 * (例外を投げない、serper-client.tsと同じ設計方針)。画像検索は補助的な
 * 情報収集であり、その障害でルート検索全体を落としてはならないため。
 */

const IMAGE_SEARCH_URL = "https://google.serper.dev/images";
const REQUEST_TIMEOUT_MS = 10_000;

export interface SerperImageResult {
  title: string;
  imageUrl: string;
}

interface SerperImageItem {
  title?: unknown;
  imageUrl?: unknown;
}

interface SerperImageResponse {
  images?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toImageResult(item: SerperImageItem): SerperImageResult | null {
  if (!isNonEmptyString(item.imageUrl) || !isNonEmptyString(item.title)) return null;
  return { title: item.title, imageUrl: item.imageUrl };
}

export async function serperImageSearch(
  apiKey: string,
  query: string
): Promise<SerperImageResult[]> {
  try {
    const res = await fetch(IMAGE_SEARCH_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "jp", hl: "ja" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as SerperImageResponse;
    if (!Array.isArray(data.images)) return [];

    return data.images
      .map((item) => toImageResult(item as SerperImageItem))
      .filter((item): item is SerperImageResult => item !== null);
  } catch {
    return [];
  }
}
