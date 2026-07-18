import { afterEach, describe, expect, test, vi } from "vitest";

const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

const afterMock = vi.fn();
vi.mock("next/server", () => ({
  after: (...args: unknown[]) => afterMock(...args),
}));

const forceFlushMock = vi.fn();
vi.mock("@/instrumentation", () => ({
  langfuseSpanProcessor: { forceFlush: (...args: unknown[]) => forceFlushMock(...args) },
  __diagModuleId: "test-module-id",
}));

describe("scheduleLangfuseFlush", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("next/serverのafter()でlangfuseSpanProcessor.forceFlush()をスケジュールする", async () => {
    afterMock.mockImplementation((task: () => Promise<void>) => task());
    const { scheduleLangfuseFlush } = await import("../langfuse-flush");

    scheduleLangfuseFlush();

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(forceFlushMock).toHaveBeenCalledTimes(1);
  });

  test("after()がリクエストコンテキスト外で例外を投げても呼び出し元に伝播しない(テスト実行時等、telemetry失敗でAI生成本体を落とさない)", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    const { scheduleLangfuseFlush } = await import("../langfuse-flush");

    expect(() => scheduleLangfuseFlush()).not.toThrow();
  });

  test("forceFlush()自体が失敗(reject)しても未処理のPromise拒否にならない(after()は非同期にコールバックを実行するため、外側の同期try/catchでは捕捉できない。ネットワーク障害・認証エラー等)", async () => {
    let scheduledTask: (() => Promise<void>) | null = null;
    afterMock.mockImplementation((task: () => Promise<void>) => {
      scheduledTask = task;
    });
    forceFlushMock.mockRejectedValue(new Error("Langfuseへの送信に失敗(ネットワーク障害)"));
    const { scheduleLangfuseFlush } = await import("../langfuse-flush");

    scheduleLangfuseFlush();
    expect(scheduledTask).not.toBeNull();

    // after()に渡したコールバック自体がrejectしないことを確認する
    // (rejectすればテストランナーがunhandled rejectionとして検出する)。
    await expect(scheduledTask!()).resolves.toBeUndefined();
  });

  test("forceFlush()失敗時、エラーオブジェクトを生のまま出力しない(/ai-review指摘: LangfuseのHTTP Exporterが保持するAuthorizationヘッダー(secretKeyのbase64)がエラー形状経由でログに漏れるのを防ぐ)", async () => {
    let scheduledTask: (() => Promise<void>) | null = null;
    afterMock.mockImplementation((task: () => Promise<void>) => {
      scheduledTask = task;
    });
    const secretLeakingError = Object.assign(new Error("send failed"), {
      config: { headers: { Authorization: "Basic c2stbGYtc2VjcmV0Cg==" } },
    });
    forceFlushMock.mockRejectedValue(secretLeakingError);
    const { scheduleLangfuseFlush } = await import("../langfuse-flush");

    scheduleLangfuseFlush();
    await scheduledTask!();

    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedArgs = consoleErrorSpy.mock.calls.flat();
    const loggedText = loggedArgs
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    expect(loggedText).not.toContain("Authorization");
    expect(loggedText).not.toContain("c2stbGYtc2VjcmV0Cg==");
  });
});
