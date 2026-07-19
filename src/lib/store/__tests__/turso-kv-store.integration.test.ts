import { afterAll, describe, expect, test } from "vitest";
import { TursoKvStore } from "../turso-kv-store";
import { getTursoClient } from "../turso-client";

/**
 * TursoKvStore の結合テスト。実 Turso DB が必要なため env-gate する
 * (destination-hint-verification.test.ts と同じ多層防御)。
 *
 * 通常の `npm test` / CI では常に skip される。
 * 手動実行(実DBが要る。値はこのファイルに書かない):
 *   RUN_TURSO_INTEGRATION=1 \
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
 *   npx vitest run src/lib/store/__tests__/turso-kv-store.integration.test.ts
 *
 * 事前に turso-schema.sql を適用しておくこと(kv_cache テーブルが必要)。
 * テストは専用 collection(タイムスタンプ付き)を使い、終了時に自分の
 * データだけを掃除する。
 */

const shouldRun =
  process.env.RUN_TURSO_INTEGRATION === "1" &&
  Boolean(process.env.TURSO_DATABASE_URL) &&
  Boolean(process.env.TURSO_AUTH_TOKEN) &&
  !process.env.CI;

const COLLECTION = `__it_kv_${Date.now()}`;

describe.runIf(shouldRun)("TursoKvStore 結合テスト(実DB・手動実行専用)", () => {
  const store = new TursoKvStore();

  afterAll(async () => {
    await store.deleteByKeyPrefix(COLLECTION, "");
  });

  test("set → get → count → deleteByKeyPrefix の一連が実DBで往復する", async () => {
    await store.set(COLLECTION, "st_1:north", { text: "北改札" }, { ttlDays: 30 });
    await store.set(COLLECTION, "st_1:south", { text: "南改札" }, { ttlDays: null });

    const got = await store.get<{ text: string }>(COLLECTION, "st_1:north");
    expect(got?.value).toEqual({ text: "北改札" });
    expect(got?.verifiedAt).toBeTruthy();
    expect(got?.expiresAt).toBeTruthy();

    const gotNoTtl = await store.get<{ text: string }>(COLLECTION, "st_1:south");
    expect(gotNoTtl?.expiresAt).toBeNull();

    expect(await store.countByKeyPrefix(COLLECTION, "st_1:")).toBe(2);

    // 上書きで created_at が保たれることを確認(件数は増えない)。
    await store.set(COLLECTION, "st_1:north", { text: "北口" }, { ttlDays: 30 });
    expect(await store.countByKeyPrefix(COLLECTION, "st_1:")).toBe(2);
    const updated = await store.get<{ text: string }>(COLLECTION, "st_1:north");
    expect(updated?.value).toEqual({ text: "北口" });

    const deleted = await store.deleteByKeyPrefix(COLLECTION, "st_1:");
    expect(deleted).toBe(2);
    expect(await store.countByKeyPrefix(COLLECTION, "st_1:")).toBe(0);
    expect(await store.get(COLLECTION, "st_1:north")).toBeNull();
  });

  test("deleteOldestByKeyPrefix が最古1件を削除する", async () => {
    await store.set(COLLECTION, "old:a", "1", { ttlDays: null });
    // created_at の差を作る。
    await new Promise((r) => setTimeout(r, 1100));
    await store.set(COLLECTION, "old:b", "2", { ttlDays: null });

    await store.deleteOldestByKeyPrefix(COLLECTION, "old:");

    expect(await store.get(COLLECTION, "old:a")).toBeNull();
    expect(await store.get(COLLECTION, "old:b")).not.toBeNull();

    await store.deleteByKeyPrefix(COLLECTION, "old:");
  });

  test("getTursoClient はシングルトンを返す", () => {
    expect(getTursoClient()).toBe(getTursoClient());
  });
});
