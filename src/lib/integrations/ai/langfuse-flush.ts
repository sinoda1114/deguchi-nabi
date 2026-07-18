import { after } from "next/server";
import { langfuseSpanProcessor } from "@/instrumentation";

/**
 * エラーオブジェクトを安全な文字列に変換してログ出力する。LangfuseのHTTP
 * Exporterはリクエスト設定(Authorizationヘッダー=secretKeyのbase64値を含む)を
 * エラーオブジェクトに保持することがあるため、生のエラーオブジェクトを
 * そのままconsole.errorへ渡さない(/ai-review指摘、High)。
 */
function safeErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "unknown error";
}

/**
 * サーバーレス環境(Vercel)ではレスポンス返却後にプロセスが凍結されうるため、
 * Langfuseへのバッチ送信を`after()`でスケジュールして確実にflushする
 * (Langfuse公式ドキュメントのVercel Cloud Functions向け推奨パターン)。
 *
 * 2種類の失敗を別々に捕捉する(/ai-review指摘、Medium):
 * 1. `after()`自体の同期例外 — Next.jsのリクエストコンテキスト外(テスト実行時等)
 *    から呼ばれた場合に投げる。外側のtry/catchで捕捉する。
 * 2. `forceFlush()`の非同期拒否 — `after()`はコールバックをリクエスト完了後に
 *    非同期実行するため、外側の同期try/catchでは捕捉できない
 *    (Langfuseへのネットワーク障害・認証エラー等)。放置すると未処理の
 *    Promise拒否になるため、コールバック内側でも個別にtry/catchする。
 * いずれの失敗も、telemetry送信の失敗でAI生成本体(GeminiAiSdkClient.ts)を
 * 落とさないよう握りつぶすが、原因調査ができるようconsole.errorには残す。
 */
export function scheduleLangfuseFlush(): void {
  try {
    after(async () => {
      try {
        await langfuseSpanProcessor.forceFlush();
      } catch (e) {
        console.error("[langfuse-flush] forceFlush() failed:", safeErrorMessage(e));
      }
    });
  } catch (e) {
    console.error("[langfuse-flush] after() threw synchronously:", safeErrorMessage(e));
  }
}
