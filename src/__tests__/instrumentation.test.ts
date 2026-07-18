import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LangfuseSpanProcessor } from "@langfuse/otel";

declare global {
  var __langfuseSpanProcessor: LangfuseSpanProcessor | undefined;
  var __langfuseTelemetryRegisterPromise: Promise<void> | undefined;
}

// new演算子で呼ばれるコンストラクタをモックする場合、vi.mockファクトリ内で
// アロー関数を挟むと `new` できずTypeErrorになるため、vi.fn(function(){...})を
// そのままexportする(vi.fnは通常のfunctionをラップしていればnew呼び出し可能)。
const forceFlushMock = vi.fn();
// シングルトン化のバグ(モジュール二重評価時に別インスタンスが生成される)を
// テストで検出できるよう、呼び出しごとに新しいオブジェクトを返す
// (常に同じオブジェクトを返すモックだと、実装がglobalThisで正しく使い回して
// いなくてもテストが偶然パスしてしまう)。
const LangfuseSpanProcessorMock = vi.fn(function LangfuseSpanProcessor() {
  return { forceFlush: forceFlushMock };
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
  beforeEach(() => {
    // globalThisシングルトンはテスト間で残留するため、各テストを独立した
    // 「プロセス起動直後」の状態から始められるようリセットする。
    delete globalThis.__langfuseSpanProcessor;
    globalThis.__langfuseTelemetryRegisterPromise = undefined;
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  test("langfuseSpanProcessorはモジュール読み込み時に生成されexportされる(flush用に参照可能)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { langfuseSpanProcessor } = await import("../instrumentation");

    expect(langfuseSpanProcessor.forceFlush).toBe(forceFlushMock);
  });

  test("NEXT_RUNTIME=nodejsの場合、tracerProviderを登録しAI SDKのtelemetry統合を登録する", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register, langfuseSpanProcessor } = await import("../instrumentation");

    await register();

    expect(NodeTracerProviderMock).toHaveBeenCalledWith({
      spanProcessors: [langfuseSpanProcessor],
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

  test("モジュールが複数回評価されても、langfuseSpanProcessorはglobalThis経由で同一インスタンスを再利用する(Next.js/Turbopackが同一プロセス内でinstrumentation.tsを別モジュールグラフとして二重評価する事象の実機診断で確認済み)", async () => {
    const first = await import("../instrumentation");

    vi.resetModules();
    const second = await import("../instrumentation");

    expect(second.langfuseSpanProcessor).toBe(first.langfuseSpanProcessor);
  });

  test("register()が複数回呼ばれても、tracerProviderの登録は1回だけ行う(globalThisフラグで多重登録を防ぐ)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("../instrumentation");

    await register();
    await register();

    expect(NodeTracerProviderMock).toHaveBeenCalledTimes(1);
    expect(registerTelemetryMock).toHaveBeenCalledTimes(1);
  });

  test("モジュール再評価後のregister()も、既に登録済みなら再登録しない(globalThisフラグがモジュール境界を越えて有効であることの確認)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const first = await import("../instrumentation");
    await first.register();

    vi.resetModules();
    const second = await import("../instrumentation");
    await second.register();

    expect(NodeTracerProviderMock).toHaveBeenCalledTimes(1);
  });

  test("register()を並行呼び出ししても登録は1回だけ行う(/ai-review指摘、High: チェックと設定の間にawaitを挟むbooleanフラグでは、ほぼ同時の呼び出しが両方フラグ未設定のまますり抜けうる。まさにこのバグが対象とする「同一プロセス内でinstrumentation.tsが複数モジュールグラフからほぼ同時に評価される」状況を再現する)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("../instrumentation");

    await Promise.all([register(), register(), register()]);

    expect(NodeTracerProviderMock).toHaveBeenCalledTimes(1);
    expect(registerTelemetryMock).toHaveBeenCalledTimes(1);
  });
});
