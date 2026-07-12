const GENERATE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";
const REQUEST_TIMEOUT_MS = 15000;
// Google Search Grounding は実際にWeb検索を行うため、単発の構造化生成より大幅に時間がかかる
// (西谷駅→国際センター駅(名駅)のような遠距離・同名駅の曖昧性解消が絡む検索で実測35秒超)。
// 短いタイムアウトのままだと毎回タイムアウトで失敗し、経路情報が確認できません扱いになってしまう。
const SEARCH_REQUEST_TIMEOUT_MS = 55000;

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  groundingMetadata?: { webSearchQueries?: string[] };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

async function callGemini(
  apiKey: string,
  body: object,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<GeminiCandidate | null> {
  try {
    const res = await fetch(GENERATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as GeminiResponse;
    return data.candidates?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Gemini APIでJSON構造化出力を生成する薄いラッパー。
 * 号車・改札・出口の下書き生成に使う(結果は confidence: low 固定で扱うこと。
 * 03_STRUCTURE.md の設計原則「AIを事実の唯一の生成元にしない」に基づき、
 * 呼び出し側は必ず未検証情報として confidence を付与する)。
 *
 * ネットワーク障害・タイムアウト・不正な応答は全て null を返す(例外を投げない)。
 * AI生成はあくまで補助的なフォールバックであり、その障害でルート検索全体を
 * 落としてはならないため。
 */
export async function generateStructuredContent<T>(
  apiKey: string,
  prompt: string,
  responseSchema: object
): Promise<T | null> {
  const candidate = await callGemini(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Google Search Grounding + 構造化出力の2段階呼び出し。
 * Gemini API は `tools: [{google_search: {}}]` と `responseSchema` を
 * 同時に指定すると検索が実行されない(groundingMetadataが付かない)ため、
 * 1回目は検索のみでテキスト回答を得て検索実行を確認し、
 * 2回目でそのテキストを構造化データに変換する。
 *
 * 1回目で検索が実行されなかった(groundingMetadataが無い)場合は、
 * 根拠のない推測を避けるため null を返す。
 */
export async function searchAndGenerateStructuredContent<T>(
  apiKey: string,
  searchPrompt: string,
  extractionInstruction: string,
  responseSchema: object
): Promise<T | null> {
  const searchCandidate = await callGemini(
    apiKey,
    {
      contents: [{ parts: [{ text: searchPrompt }] }],
      tools: [{ google_search: {} }],
    },
    SEARCH_REQUEST_TIMEOUT_MS
  );

  const searchText = searchCandidate?.content?.parts?.[0]?.text;
  const searchExecuted = (searchCandidate?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0;
  if (!searchText || !searchExecuted) return null;

  const extractionCandidate = await callGemini(apiKey, {
    contents: [{ parts: [{ text: `${extractionInstruction}\n\n${searchText}` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const extractedText = extractionCandidate?.content?.parts?.[0]?.text;
  if (!extractedText) return null;

  try {
    return JSON.parse(extractedText) as T;
  } catch {
    return null;
  }
}
