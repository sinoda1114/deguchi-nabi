import { LangfuseSpanProcessor } from "@langfuse/otel";

/**
 * Vercel AI SDK呼び出し(GeminiAiSdkClient.ts)のtelemetryをLangfuseへ送るための
 * SpanProcessor。モジュール読み込み時に生成しexportする(サーバーレス環境で
 * リクエスト終了後にflushするため、langfuse-flush.tsから参照できる必要がある)。
 * LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY/LANGFUSE_BASE_URL未設定の場合は
 * 送信先が無いだけで、生成自体はエラーにならない(Langfuse SDKの既定挙動)。
 */
export const langfuseSpanProcessor = new LangfuseSpanProcessor();
export const __diagModuleId = Math.random().toString(36).slice(2);
console.log("[DIAG] instrumentation.ts module evaluated, moduleId=", __diagModuleId);

/**
 * Next.jsのinstrumentation規約(https://nextjs.org/docs/app/guides/instrumentation)に
 * 従い、サーバー起動時に一度だけ呼ばれる。OpenTelemetryのトレーサー登録・
 * Vercel AI SDKのtelemetry統合登録はNode専用APIに依存するため、
 * Edge runtimeではスキップする(NEXT_RUNTIMEガード)。
 */
export async function register(): Promise<void> {
  console.log("[DIAG] instrumentation.register() called. NEXT_RUNTIME=", process.env.NEXT_RUNTIME);
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
  const { registerTelemetry } = await import("ai");
  const { LangfuseVercelAiSdkIntegration } = await import("@langfuse/vercel-ai-sdk");

  const tracerProvider = new NodeTracerProvider({
    spanProcessors: [langfuseSpanProcessor],
  });
  tracerProvider.register();

  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  console.log("[DIAG] instrumentation.register() completed, telemetry registered");
}
