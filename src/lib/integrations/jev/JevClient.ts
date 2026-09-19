/**
 * TypeSafe System One (JEV) ヘルスチェッククライアント
 * 疎通確認とfail-open機能を提供
 */

import { TypeSafeClient, noul } from "@typesafe-ai/sdk";

export interface JevHealthCheckResult {
  ok: boolean;
  reason?: string;
}

const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * TypeSafe System Oneヘルスチェック（noop decision呼び出し）
 */
export async function checkJevHealth(): Promise<JevHealthCheckResult> {
  const JEV_API_KEY = process.env.JEV_API_KEY;

  if (!JEV_API_KEY) {
    return { ok: false, reason: "missing_key" };
  }

  try {
    const client = new TypeSafeClient({
      apiKey: JEV_API_KEY,
      timeout: HEALTH_CHECK_TIMEOUT_MS,
    });

    await client.systemOne({
      state: { healthCheck: true },
      questions: {
        alive: noul("Is the system operational?", {
          yes: "System is operational",
          no: "System is down",
        }),
      },
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      const name = error.name.toLowerCase();
      
      if (name === "aborterror" || msg.includes("timeout") || msg.includes("timed out") || name.includes("timeout")) {
        return { ok: false, reason: "timeout" };
      }
      
      if (msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("authentication") || msg.includes("api key") || msg.includes("401") || msg.includes("403")) {
        return { ok: false, reason: "auth_error" };
      }
      
      return { ok: false, reason: "upstream_error" };
    }
    return { ok: false, reason: "unknown_error" };
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
