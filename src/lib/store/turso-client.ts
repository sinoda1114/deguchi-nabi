import { createClient, type Client } from "@libsql/client/web";

/**
 * @libsql/client/web の createClient を globalThis シングルトン化する。
 * `/web` は fetch ベースのHTTPドライバでネイティブビルド不要。Vercelの
 * サーバーレス/Edge を含め確実に動作する。
 * globalThis に載せる理由は instrumentation.ts と同じ(Next.js/Turbopack の
 * 二重モジュール評価でも同一クライアントを共有し、無駄な接続を作らない)。
 */

declare global {
  var __tursoClient: Client | undefined;
}

export function getTursoClient(): Client {
  if (globalThis.__tursoClient) return globalThis.__tursoClient;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error(
      "TURSO_DATABASE_URL / TURSO_AUTH_TOKEN が未設定です。getTursoClient() は" +
        "両方が設定されている前提で呼ばれます(呼び出し側の分岐ミス)。"
    );
  }

  const client = createClient({ url, authToken });
  globalThis.__tursoClient = client;
  return client;
}
