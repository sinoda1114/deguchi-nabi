/**
 * TypeSafe System One (JEV) ヘルスチェッククライアント
 * 疎通確認とfail-open機能を提供
 */

import { TypeSafeClient, noul } from "@typesafe-ai/sdk";

export interface JevHealthCheckResult {
  ok: boolean;
  reason?: string;
  code?: string;
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
  } catch (error: unknown) {
    const err = error as { status?: number; statusCode?: number; response?: { status?: number }; code?: string; type?: string; message?: string; name?: string };
    const status = err.status || err.statusCode || err.response?.status;
    const code = err.code || err.type;
    const msg = err.message || String(error);
    const name = err.name || "";
    
    console.error("[JevClient] Health check failed:", {
      name,
      status,
      code,
      messageSafe: msg.substring(0, 100).replace(/[a-z0-9]{20,}/gi, "[REDACTED]"),
    });
    
    if (name === "AbortError" || /timeout|timed out/i.test(msg) || /timeout/i.test(name)) {
      return { ok: false, reason: "timeout", code };
    }
    
    if (status === 401 || status === 403 || /unauthorized|forbidden|authentication|invalid.*key|401|403/i.test(msg) || code === "authentication_error") {
      return { ok: false, reason: "auth_error", code };
    }
    
    return { ok: false, reason: "upstream_error", code };
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
