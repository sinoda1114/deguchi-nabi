const REQUEST_TIMEOUT_MS = 15000;
// Google Search Grounding は実際にWeb検索を行うため、単発の構造化生成より大幅に時間がかかる
// (西谷駅→国際センター駅(名駅)のような遠距離・同名駅の曖昧性解消が絡む検索で実測35秒超)。
// 短いタイムアウトのままだと毎回タイムアウトで失敗し、経路情報が確認できません扱いになってしまう。
//
// 2026-07-21: 単一呼び出し方式(single-call-navigator.ts)の改善プロンプトは、
// 実在確認と適合性検証の分離・複数改札比較・情報源優先順位等を1回の検索に
// 詰め込んだ長いプロンプトのため、実機検証で55秒の壁を越えてタイムアウトし
// サイレントにnullを返すケースを確認した(8回実測では38.9〜75.6秒だったが、
// 実配線検証では2回とも55秒ちょうどでタイムアウトし空振りした)。100秒へ延長する。
const SEARCH_REQUEST_TIMEOUT_MS = 100000;

function generateUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  groundingMetadata?: { webSearchQueries?: string[] };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

async function callGemini(
  apiKey: string,
  model: string,
  body: object,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<GeminiCandidate | null> {
  try {
    const res = await fetch(generateUrl(model), {
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
  responseSchema: object,
  model: string
): Promise<T | null> {
  const candidate = await callGemini(apiKey, model, {
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
  responseSchema: object,
  model: string
): Promise<T | null> {
  const searchCandidate = await callGemini(
    apiKey,
    model,
    {
      contents: [{ parts: [{ text: searchPrompt }] }],
      tools: [{ google_search: {} }],
    },
    SEARCH_REQUEST_TIMEOUT_MS
  );

  const searchText = searchCandidate?.content?.parts?.[0]?.text;
  const searchExecuted = (searchCandidate?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0;
  if (!searchText || !searchExecuted) return null;

  return extractStructuredContent<T>(apiKey, model, extractionInstruction, searchText, responseSchema);
}

/**
 * Google Search Grounding + 構造化出力の2段階呼び出し。searchAndGenerate
 * StructuredContentと同じだが、抽出結果に加えて検索フェーズの生テキストも
 * 返す。呼び出し側が抽出結果の逐語一致検証(例: single-call-navigator.tsの
 * isVerbatimInSearchText)を行うために必要(通常のsearchAndGenerateStructured
 * Contentは検索フェーズのテキストを抽出後に破棄しており、検証できない)。
 * 既存のsearchAndGenerateStructuredContentは変更せず維持する(他の呼び出し元
 * への影響を避けるため)。
 */
export async function searchAndGenerateStructuredContentWithSearchText<T>(
  apiKey: string,
  searchPrompt: string,
  extractionInstruction: string,
  responseSchema: object,
  model: string
): Promise<{ data: T; searchText: string } | null> {
  const searchCandidate = await callGemini(
    apiKey,
    model,
    {
      contents: [{ parts: [{ text: searchPrompt }] }],
      tools: [{ google_search: {} }],
    },
    SEARCH_REQUEST_TIMEOUT_MS
  );

  const searchText = searchCandidate?.content?.parts?.[0]?.text;
  const searchExecuted = (searchCandidate?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0;
  if (!searchText || !searchExecuted) return null;

  const data = await extractStructuredContent<T>(
    apiKey,
    model,
    extractionInstruction,
    searchText,
    responseSchema
  );
  if (data === null) return null;

  return { data, searchText };
}

export interface InlineImage {
  data: string;
  mimeType: string;
}

/**
 * Google Search Grounding + 画像入力 + 構造化出力の2段階呼び出し。
 * searchAndGenerateStructuredContent と同じ2段階パターンだが、1回目の検索
 * フェーズに画像パート(inline_data)を追加する。Gemini API は google_search
 * ツールと画像入力を同一リクエストで併用できる(検証済み)ため、モデルは
 * 画像の内容とWeb検索結果の両方を踏まえてテキスト回答を生成する。
 *
 * どの画像を使うかは呼び出し側が能動的に選定・取得する(Groundingの検索
 * 過程自体はブラックボックスで、モデルが「見た」画像を外部から制御できない
 * ため。facilities-image-search.ts参照)。
 */
export async function searchAndGenerateStructuredContentWithImage<T>(
  apiKey: string,
  searchPrompt: string,
  extractionInstruction: string,
  responseSchema: object,
  image: InlineImage,
  model: string
): Promise<T | null> {
  const searchCandidate = await callGemini(
    apiKey,
    model,
    {
      contents: [
        {
          parts: [
            { text: searchPrompt },
            { inline_data: { mime_type: image.mimeType, data: image.data } },
          ],
        },
      ],
      tools: [{ google_search: {} }],
    },
    SEARCH_REQUEST_TIMEOUT_MS
  );

  const searchText = searchCandidate?.content?.parts?.[0]?.text;
  const searchExecuted = (searchCandidate?.groundingMetadata?.webSearchQueries?.length ?? 0) > 0;
  if (!searchText || !searchExecuted) return null;

  return extractStructuredContent<T>(apiKey, model, extractionInstruction, searchText, responseSchema);
}

/**
 * 検索/画像フェーズで得たテキストをJSON構造化データへ変換する共有ヘルパー。
 * searchAndGenerateStructuredContent と searchAndGenerateStructuredContentWithImage
 * の両方から使い、抽出ロジックの二重管理を防ぐ。
 */
async function extractStructuredContent<T>(
  apiKey: string,
  model: string,
  extractionInstruction: string,
  searchText: string,
  responseSchema: object
): Promise<T | null> {
  const extractionCandidate = await callGemini(apiKey, model, {
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
