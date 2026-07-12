const GENERATE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";
const REQUEST_TIMEOUT_MS = 15000;

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
  try {
    const res = await fetch(GENERATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
