import { afterEach, describe, expect, test, vi } from "vitest";

const afterMock = vi.fn();
vi.mock("next/server", () => ({
  after: (...args: unknown[]) => afterMock(...args),
}));

const forceFlushMock = vi.fn();
vi.mock("@/instrumentation", () => ({
  langfuseSpanProcessor: { forceFlush: (...args: unknown[]) => forceFlushMock(...args) },
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
});
