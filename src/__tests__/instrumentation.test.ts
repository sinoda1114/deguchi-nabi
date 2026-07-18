import { afterEach, describe, expect, test, vi } from "vitest";

// new演算子で呼ばれるコンストラクタをモックする場合、vi.mockファクトリ内で
// アロー関数を挟むと `new` できずTypeErrorになるため、vi.fn(function(){...})を
// そのままexportする(vi.fnは通常のfunctionをラップしていればnew呼び出し可能)。
const forceFlushMock = vi.fn();
const langfuseSpanProcessorInstance = { forceFlush: forceFlushMock };
const LangfuseSpanProcessorMock = vi.fn(function LangfuseSpanProcessor() {
  return langfuseSpanProcessorInstance;
});
vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: LangfuseSpanProcessorMock,
}));

const tracerProviderRegisterMock = vi.fn();
const NodeTracerProviderMock = vi.fn(function NodeTracerProvider() {
  return { register: tracerProviderRegisterMock };
});
vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: NodeTracerProviderMock,
}));

const registerTelemetryMock = vi.fn();
vi.mock("ai", () => ({
  registerTelemetry: (...args: unknown[]) => registerTelemetryMock(...args),
}));

const LangfuseVercelAiSdkIntegrationMock = vi.fn(function LangfuseVercelAiSdkIntegration() {
  return { kind: "langfuse-integration" };
});
vi.mock("@langfuse/vercel-ai-sdk", () => ({
  LangfuseVercelAiSdkIntegration: LangfuseVercelAiSdkIntegrationMock,
}));

describe("instrumentation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  test("langfuseSpanProcessorはモジュール読み込み時に生成されexportされる(flush用に参照可能)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { langfuseSpanProcessor } = await import("../instrumentation");

    expect(langfuseSpanProcessor).toBe(langfuseSpanProcessorInstance);
  });

  test("NEXT_RUNTIME=nodejsの場合、tracerProviderを登録しAI SDKのtelemetry統合を登録する", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("../instrumentation");

    await register();

    expect(NodeTracerProviderMock).toHaveBeenCalledWith({
      spanProcessors: [langfuseSpanProcessorInstance],
    });
    expect(tracerProviderRegisterMock).toHaveBeenCalledTimes(1);
    expect(LangfuseVercelAiSdkIntegrationMock).toHaveBeenCalledTimes(1);
    expect(registerTelemetryMock).toHaveBeenCalledWith({ kind: "langfuse-integration" });
  });

  test("NEXT_RUNTIME=edgeの場合、Node専用のセットアップをスキップする(Edge bundleへの混入回避)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("../instrumentation");

    await register();

    expect(NodeTracerProviderMock).not.toHaveBeenCalled();
    expect(registerTelemetryMock).not.toHaveBeenCalled();
  });

  test("NEXT_RUNTIME未設定の場合もNode専用のセットアップをスキップする", async () => {
    vi.stubEnv("NEXT_RUNTIME", "");
    const { register } = await import("../instrumentation");

    await register();

    expect(NodeTracerProviderMock).not.toHaveBeenCalled();
  });
});
