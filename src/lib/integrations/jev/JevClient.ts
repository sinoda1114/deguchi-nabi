/**
 * TypeSafe System One (JEV) クライアント
 * 疎通確認とfail-open機能を提供
 */

export interface JevHealthCheckResult {
  ok: boolean;
  error?: string;
}

const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * TypeSafe System Oneヘルスチェック（noop decision呼び出し）
 */
export async function checkJevHealth(): Promise<JevHealthCheckResult> {
  const JEV_API_KEY = process.env.JEV_API_KEY;
  const JEV_API_ENDPOINT = process.env.JEV_API_ENDPOINT || "https://api.typesafe.ai/v1";

  if (!JEV_API_KEY) {
    return { ok: false, error: "missing_key" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(`${JEV_API_ENDPOINT}/health`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${JEV_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { ok: false, error: "upstream_error" };
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return { ok: false, error: "timeout" };
      }
      return { ok: false, error: "upstream_error" };
    }
    return { ok: false, error: "unknown_error" };
  }
}

/**
 * fail-openラッパー: エラー時はnullを返して呼び出し元の処理を継続させる
 */
export async function callJevSafely<T>(
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error("[JevClient] fail-open: error caught", error);
    return null;
  }
}
