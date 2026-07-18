import { after } from "next/server";
import { langfuseSpanProcessor } from "@/instrumentation";

/**
 * サーバーレス環境(Vercel)ではレスポンス返却後にプロセスが凍結されうるため、
 * Langfuseへのバッチ送信を`after()`でスケジュールして確実にflushする
 * (Langfuse公式ドキュメントのVercel Cloud Functions向け推奨パターン)。
 *
 * `after()`はNext.jsのリクエストコンテキスト内でのみ呼び出せる。テスト実行時
 * (vitest)等、コンテキスト外から呼ばれると例外を投げるため、telemetry送信の
 * 失敗でAI生成本体(GeminiAiSdkClient.ts)を落とさないようここで握りつぶす。
 */
export function scheduleLangfuseFlush(): void {
  try {
    after(async () => {
      await langfuseSpanProcessor.forceFlush();
    });
  } catch {
    // リクエストコンテキスト外。telemetryは諦めるが、呼び出し元は継続させる。
  }
}
