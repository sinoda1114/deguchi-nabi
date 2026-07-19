import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const afterMock = vi.fn();

vi.mock("next/server", () => ({
  after: (cb: () => Promise<void>) => afterMock(cb),
}));

describe("isCacheEntryExpired", () => {
  test("expiresAtがnullなら無期限扱いでfalse", async () => {
    const { isCacheEntryExpired } = await import("../swr-refresh");
    expect(isCacheEntryExpired(null)).toBe(false);
  });

  test("expiresAtが未来ならfalse", async () => {
    const { isCacheEntryExpired } = await import("../swr-refresh");
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isCacheEntryExpired(future)).toBe(false);
  });

  test("expiresAtが過去ならtrue", async () => {
    const { isCacheEntryExpired } = await import("../swr-refresh");
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isCacheEntryExpired(past)).toBe(true);
  });

  test("expiresAtが不正な日時文字列ならtrue(期限切れ扱いにして安全側へ倒す)", async () => {
    const { isCacheEntryExpired } = await import("../swr-refresh");
    expect(isCacheEntryExpired("not-a-valid-date")).toBe(true);
  });
});

describe("scheduleStaleRefresh", () => {
  beforeEach(() => {
    afterMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("after()経由で再生成コールバックがスケジュールされる", async () => {
    const { scheduleStaleRefresh } = await import("../swr-refresh");
    const refresh = vi.fn().mockResolvedValue(undefined);

    scheduleStaleRefresh("test-key-1", refresh);

    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  test("同一キーへの多重呼び出しは1回だけスケジュールする(in-flight重複ガード)", async () => {
    const { scheduleStaleRefresh } = await import("../swr-refresh");
    const refresh = vi.fn().mockResolvedValue(undefined);

    scheduleStaleRefresh("test-key-2", refresh);
    scheduleStaleRefresh("test-key-2", refresh);
    scheduleStaleRefresh("test-key-2", refresh);

    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  test("再生成完了後は同一キーを再度スケジュールできる", async () => {
    const { scheduleStaleRefresh } = await import("../swr-refresh");
    const refresh = vi.fn().mockResolvedValue(undefined);
    afterMock.mockImplementation((cb: () => Promise<void>) => cb());

    await scheduleStaleRefreshAndWait("test-key-3", refresh);
    scheduleStaleRefresh("test-key-3", refresh);

    expect(afterMock).toHaveBeenCalledTimes(2);

    async function scheduleStaleRefreshAndWait(key: string, fn: () => Promise<void>) {
      scheduleStaleRefresh(key, fn);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  test("refreshが例外を投げても呼び出し元に伝播しない(fire-and-forget)", async () => {
    const { scheduleStaleRefresh } = await import("../swr-refresh");
    const refresh = vi.fn().mockRejectedValue(new Error("regenerate failed"));
    afterMock.mockImplementation((cb: () => Promise<void>) => cb());

    expect(() => scheduleStaleRefresh("test-key-4", refresh)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test("after()がリクエストコンテキスト外で同期的に例外を投げても呼び出し元に伝播しない", async () => {
    const { scheduleStaleRefresh } = await import("../swr-refresh");
    const refresh = vi.fn().mockResolvedValue(undefined);
    afterMock.mockImplementation(() => {
      throw new Error("outside request context");
    });

    expect(() => scheduleStaleRefresh("test-key-5", refresh)).not.toThrow();
  });

  test("after()が同期的に失敗した後は同一キーを再度スケジュールできる", async () => {
    const { scheduleStaleRefresh } = await import("../swr-refresh");
    const refresh = vi.fn().mockResolvedValue(undefined);
    afterMock.mockImplementationOnce(() => {
      throw new Error("outside request context");
    });
    afterMock.mockImplementationOnce((cb: () => Promise<void>) => cb());

    scheduleStaleRefresh("test-key-6", refresh);
    scheduleStaleRefresh("test-key-6", refresh);

    expect(afterMock).toHaveBeenCalledTimes(2);
  });
});
