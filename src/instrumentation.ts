import { LangfuseSpanProcessor } from "@langfuse/otel";

declare global {
  var __langfuseSpanProcessor: LangfuseSpanProcessor | undefined;
  var __langfuseTelemetryRegisterPromise: Promise<void> | undefined;
}

/**
 * Vercel AI SDK呼び出し(GeminiAiSdkClient.ts)のtelemetryをLangfuseへ送るための
 * SpanProcessor。モジュール読み込み時に生成しexportする(サーバーレス環境で
 * リクエスト終了後にflushするため、langfuse-flush.tsから参照できる必要がある)。
 *
 * globalThisにキャッシュする理由: Next.js/Turbopackは同一プロセス内でも
 * instrumentation.tsを複数のモジュールグラフ(RSCレンダリング用バンドルと
 * Node.jsランタイムエントリ等)から別々に評価することがある。単純な
 * `export const`だけでは評価のたびに別インスタンスが生成され、register()が
 * OpenTelemetryのtracerProviderに登録したインスタンスと、langfuse-flush.tsが
 * 実際にforceFlush()を呼ぶインスタンスが食い違ってしまう(登録されていない
 * 孤立したインスタンスをflushしても何も送信されない)。実機診断で本番の
 * Langfuseにトレースが1件も届かない原因がこれだったことを確認済み。
 *
 * LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY/LANGFUSE_BASE_URL未設定の場合は
 * 送信先が無いだけで、生成自体はエラーにならない(Langfuse SDKの既定挙動)。
 */
export const langfuseSpanProcessor =
  globalThis.__langfuseSpanProcessor ?? new LangfuseSpanProcessor();
globalThis.__langfuseSpanProcessor = langfuseSpanProcessor;

/**
 * Next.jsのinstrumentation規約(https://nextjs.org/docs/app/guides/instrumentation)に
 * 従い、サーバー起動時に呼ばれる。OpenTelemetryのトレーサー登録・
 * Vercel AI SDKのtelemetry統合登録はNode専用APIに依存するため、
 * Edge runtimeではスキップする(NEXT_RUNTIMEガード)。
 *
 * globalThisに共有Promiseを保存して多重登録を防ぐ(/ai-review指摘、High):
 * 上記のモジュール二重評価により register() 自体もほぼ同時に複数回呼ばれうる。
 * booleanフラグだと「チェック→await import(...)→設定」の間に他の呼び出しが
 * 割り込みうる(JSはシングルスレッドだが、awaitのたびに制御が戻るため)。
 * Promiseそのものをキャッシュすれば、Promiseの生成・格納自体はawaitを挟まない
 * 同期処理のため、後続の呼び出しは必ず先行呼び出しの同じPromiseを見つけて
 * awaitするだけになり、実際の登録処理(tracerProvider.register()等)は1回しか
 * 走らない。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!globalThis.__langfuseTelemetryRegisterPromise) {
    globalThis.__langfuseTelemetryRegisterPromise = (async () => {
      const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
      const { registerTelemetry } = await import("ai");
      const { LangfuseVercelAiSdkIntegration } = await import("@langfuse/vercel-ai-sdk");

      const tracerProvider = new NodeTracerProvider({
        spanProcessors: [langfuseSpanProcessor],
      });
      tracerProvider.register();

      registerTelemetry(new LangfuseVercelAiSdkIntegration());
    })();
  }

  await globalThis.__langfuseTelemetryRegisterPromise;
}
