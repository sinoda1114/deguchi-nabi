import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const executeMock = vi.fn();

vi.mock("@/lib/store/turso-client", () => ({
  getTursoClient: () => ({ execute: executeMock }),
}));

import {
  checkIpRateLimit,
  checkRoutesSearchRateLimit,
  extractClientIp,
} from "../ip-rate-limit";

const ORIGINAL_ENV = { ...process.env };

describe("checkIpRateLimit", () => {
  beforeEach(() => {
    executeMock.mockReset();
    process.env.TURSO_DATABASE_URL = "libsql://test-db";
    process.env.TURSO_AUTH_TOKEN = "test-token";
    // 掃除(cleanup)の確率的発火をデフォルトでは無効化し、テストを決定的にする。
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  test("limit未満ならallowed: true", async () => {
    executeMock.mockResolvedValue({ rows: [{ count: 3 }] });

    const result = await checkIpRateLimit("1.2.3.4", "test-scope", {
      limit: 10,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  test("limit到達でallowed: false、retryAfterSecondsが返る", async () => {
    executeMock.mockResolvedValue({ rows: [{ count: 11 }] });

    const result = await checkIpRateLimit("1.2.3.4", "test-scope", {
      limit: 10,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  test("Turso未設定(env未設定)ならfail-openでallowed: true", async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;

    const result = await checkIpRateLimit("1.2.3.4", "test-scope");

    expect(result.allowed).toBe(true);
    expect(executeMock).not.toHaveBeenCalled();
  });

  test("Tursoクエリが例外を投げてもfail-openでallowed: true", async () => {
    executeMock.mockRejectedValue(new Error("network error"));

    const result = await checkIpRateLimit("1.2.3.4", "test-scope");

    expect(result.allowed).toBe(true);
  });

  test("bucketはscopeとipから組み立てられ、パラメータバインディングで渡される", async () => {
    executeMock.mockResolvedValue({ rows: [{ count: 1 }] });

    await checkIpRateLimit("9.9.9.9", "routes-search", { limit: 10, windowSeconds: 60 });

    expect(executeMock).toHaveBeenCalledTimes(1);
    const [, params] = executeMock.mock.calls[0];
    expect(params[0]).toBe("routes-search:9.9.9.9");
  });

  test("掃除(cleanup)がエラーを投げても本体の判定結果に影響しない", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 常に掃除を発火させる
    executeMock
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // メインのINSERT
      .mockRejectedValueOnce(new Error("cleanup failed")); // DELETE(掃除)

    const result = await checkIpRateLimit("1.2.3.4", "test-scope");

    expect(result.allowed).toBe(true);
    // 掃除のcatchが解決するまでマイクロタスクを待つ(未処理例外が漏れないことの確認)。
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("checkRoutesSearchRateLimit", () => {
  beforeEach(() => {
    executeMock.mockReset();
    process.env.TURSO_DATABASE_URL = "libsql://test-db";
    process.env.TURSO_AUTH_TOKEN = "test-token";
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  test("分間・日次どちらも許可ならallowed: true(両方Turso呼び出しされる)", async () => {
    executeMock.mockResolvedValue({ rows: [{ count: 1 }] });

    const result = await checkRoutesSearchRateLimit("1.2.3.4");

    expect(result.allowed).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  test("分間チェックで制限超過なら日次チェックは省略される(早期return)", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ count: 999 }] });

    const result = await checkRoutesSearchRateLimit("1.2.3.4");

    expect(result.allowed).toBe(false);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});

describe("extractClientIp", () => {
  test("x-forwarded-forの先頭値を使う", () => {
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" });
    expect(extractClientIp(headers)).toBe("1.1.1.1");
  });

  test("x-forwarded-forが無ければx-real-ipにフォールバックする", () => {
    const headers = new Headers({ "x-real-ip": "3.3.3.3" });
    expect(extractClientIp(headers)).toBe("3.3.3.3");
  });

  test("どちらも無ければunknownを返す", () => {
    const headers = new Headers();
    expect(extractClientIp(headers)).toBe("unknown");
  });

  test("異常に長いx-forwarded-for値は64文字に切り詰められる", () => {
    const longValue = "a".repeat(200);
    const headers = new Headers({ "x-forwarded-for": longValue });
    expect(extractClientIp(headers)).toBe("a".repeat(64));
  });

  test("異常に長いx-real-ip値は64文字に切り詰められる", () => {
    const longValue = "b".repeat(200);
    const headers = new Headers({ "x-real-ip": longValue });
    expect(extractClientIp(headers)).toBe("b".repeat(64));
  });
});
