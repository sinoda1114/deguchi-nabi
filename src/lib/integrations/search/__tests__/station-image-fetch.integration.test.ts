import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Agent, fetch as undiciFetch } from "undici";
import { createSsrfSafeLookup, fetchImageAsInlineData } from "../station-image-fetch";

/**
 * undici・dns をモックしない結合テスト。SSRF 対策が頼る `connect.lookup` フックを、
 * 実際の undici が接続時に必ず通ることを確かめる（undici 更新時の回帰検知用）。
 */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

let server: http.Server;
let port = 0;
let hitCount = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    hitCount += 1;
    res.writeHead(200, { "content-type": "image/png" });
    res.end(PNG_BYTES);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("fetchImageAsInlineData (実 undici)", () => {
  test("対照: ガード無しの Agent ならローカルサーバに到達できる（テスト環境が有効であることの確認）", async () => {
    hitCount = 0;
    const agent = new Agent();
    const res = await undiciFetch(`http://127.0.0.1:${port}/a.png`, { dispatcher: agent });
    await res.arrayBuffer();
    await agent.close();
    expect(res.status).toBe(200);
    expect(hitCount).toBe(1);
  });

  test("loopback に解決されるホスト名は接続前にブロックされ、サーバに到達しない", async () => {
    hitCount = 0;
    const result = await fetchImageAsInlineData(`http://localhost:${port}/a.png`);
    expect(result).toBeNull();
    expect(hitCount).toBe(0);
  });

  test("ガードで止まった理由が SSRF ガード由来であること（フック破損による別理由の失敗と区別する）", async () => {
    hitCount = 0;
    const agent = new Agent({ connect: { lookup: createSsrfSafeLookup() } });
    const error = await undiciFetch(`http://localhost:${port}/a.png`, { dispatcher: agent }).then(
      () => null,
      (e: unknown) => e,
    );
    await agent.close();
    const causeMessage = (error as { cause?: { message?: string } } | null)?.cause?.message ?? "";
    expect(causeMessage).toContain("SSRF guard");
    expect(hitCount).toBe(0);
  });
});
