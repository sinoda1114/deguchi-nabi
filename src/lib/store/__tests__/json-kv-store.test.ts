import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * JsonKvStore の単体テスト。
 * json-file-store をインメモリの storeState でモックし、副作用のある
 * ファイルI/Oを排除する(既存の favorite-destination-repository.test.ts と同じ発想)。
 * createdAt の保持など、KvCacheStore インターフェースからは読めない内部状態は
 * storeState を直接検査する(ホワイトボックス)。
 */

interface JsonKvRow {
  key: string;
  value_json: string;
  verifiedAt: string;
  expiresAt: string | null;
  createdAt: string;
}

const storeState: Record<string, unknown[]> = {};

vi.mock("@/lib/store/json-file-store", () => ({
  readCollection: vi.fn((name: string) => storeState[name] ?? []),
  writeCollection: vi.fn((name: string, items: unknown[]) => {
    storeState[name] = items;
  }),
}));

const { JsonKvStore } = await import("../json-kv-store");

function rowsOf(collection: string): JsonKvRow[] {
  return (storeState[`kv-${collection}`] as JsonKvRow[] | undefined) ?? [];
}

describe("JsonKvStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeState)) delete storeState[key];
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("set した値が get で value/verifiedAt/expiresAt まで往復する", async () => {
    const store = new JsonKvStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    await store.set("gate", "st_1", { text: "北改札" }, { ttlDays: null });
    const got = await store.get<{ text: string }>("gate", "st_1");

    expect(got).not.toBeNull();
    expect(got?.value).toEqual({ text: "北改札" });
    expect(got?.verifiedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(got?.expiresAt).toBeNull();
  });

  test("ttlDays 指定時、expiresAt が verifiedAt + 日数になる", async () => {
    const store = new JsonKvStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    await store.set("gate", "st_1", "値", { ttlDays: 7 });
    const got = await store.get("gate", "st_1");

    expect(got?.verifiedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(got?.expiresAt).toBe("2026-01-08T00:00:00.000Z");
  });

  test("ttlDays=null のとき expiresAt は null", async () => {
    const store = new JsonKvStore();

    await store.set("gate", "st_1", "値", { ttlDays: null });
    const got = await store.get("gate", "st_1");

    expect(got?.expiresAt).toBeNull();
  });

  test("get はミス時 null を返す", async () => {
    const store = new JsonKvStore();

    expect(await store.get("gate", "存在しない")).toBeNull();
  });

  test("同一 key への再 set は上書きし、createdAt は初回を保持する", async () => {
    const store = new JsonKvStore();
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await store.set("gate", "st_1", { v: 1 }, { ttlDays: null });
    const firstCreatedAt = rowsOf("gate")[0].createdAt;

    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    await store.set("gate", "st_1", { v: 2 }, { ttlDays: null });

    const rows = rowsOf("gate");
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toBe(firstCreatedAt);
    expect(rows[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(rows[0].verifiedAt).toBe("2026-01-02T00:00:00.000Z");

    const got = await store.get<{ v: number }>("gate", "st_1");
    expect(got?.value).toEqual({ v: 2 });
  });

  test("deleteByKeyPrefix は前方一致を削除し件数を返す。他 prefix/他 collection は消さない", async () => {
    const store = new JsonKvStore();
    await store.set("gate", "st_1:north", "a", { ttlDays: null });
    await store.set("gate", "st_1:south", "b", { ttlDays: null });
    await store.set("gate", "st_2:north", "c", { ttlDays: null });
    await store.set("exit", "st_1:north", "d", { ttlDays: null });

    const deleted = await store.deleteByKeyPrefix("gate", "st_1:");

    expect(deleted).toBe(2);
    expect(await store.get("gate", "st_1:north")).toBeNull();
    expect(await store.get("gate", "st_1:south")).toBeNull();
    // 他 prefix
    expect(await store.get("gate", "st_2:north")).not.toBeNull();
    // 他 collection
    expect(await store.get("exit", "st_1:north")).not.toBeNull();
  });

  test("deleteByKeyPrefix は一致0件のとき 0 を返す", async () => {
    const store = new JsonKvStore();
    await store.set("gate", "st_1", "a", { ttlDays: null });

    expect(await store.deleteByKeyPrefix("gate", "no-match")).toBe(0);
  });

  test("countByKeyPrefix は前方一致の件数を返す", async () => {
    const store = new JsonKvStore();
    await store.set("gate", "st_1:north", "a", { ttlDays: null });
    await store.set("gate", "st_1:south", "b", { ttlDays: null });
    await store.set("gate", "st_2:north", "c", { ttlDays: null });

    expect(await store.countByKeyPrefix("gate", "st_1:")).toBe(2);
    expect(await store.countByKeyPrefix("gate", "st_")).toBe(3);
    expect(await store.countByKeyPrefix("gate", "none")).toBe(0);
  });

  test("deleteOldestByKeyPrefix は createdAt 最古の1件だけ削除する", async () => {
    const store = new JsonKvStore();
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await store.set("gate", "st_1:a", "oldest", { ttlDays: null });
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    await store.set("gate", "st_1:b", "mid", { ttlDays: null });
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    await store.set("gate", "st_1:c", "newest", { ttlDays: null });
    // 別 prefix(消えてはいけない)
    await store.set("gate", "st_2:a", "other", { ttlDays: null });

    await store.deleteOldestByKeyPrefix("gate", "st_1:");

    expect(await store.get("gate", "st_1:a")).toBeNull();
    expect(await store.get("gate", "st_1:b")).not.toBeNull();
    expect(await store.get("gate", "st_1:c")).not.toBeNull();
    expect(await store.get("gate", "st_2:a")).not.toBeNull();
    expect(await store.countByKeyPrefix("gate", "st_1:")).toBe(2);
  });

  test("deleteOldestByKeyPrefix は一致0件でも例外を投げない", async () => {
    const store = new JsonKvStore();

    await expect(store.deleteOldestByKeyPrefix("gate", "none")).resolves.toBeUndefined();
  });

  describe("I/O障害時の握りつぶし(キャッシュは最適化にすぎず、障害が本体機能を巻き込んではならない。/ai-review指摘、High)", () => {
    test("readCollectionが例外を投げても get は null を返す", async () => {
      const { readCollection } = await import("@/lib/store/json-file-store");
      vi.mocked(readCollection).mockImplementationOnce(() => {
        throw new Error("読み取り専用ファイルシステム");
      });
      const store = new JsonKvStore();

      await expect(store.get("gate", "st_1")).resolves.toBeNull();
    });

    test("readCollectionが例外を投げても countByKeyPrefix は 0 を返す", async () => {
      const { readCollection } = await import("@/lib/store/json-file-store");
      vi.mocked(readCollection).mockImplementationOnce(() => {
        throw new Error("読み取り専用ファイルシステム");
      });
      const store = new JsonKvStore();

      await expect(store.countByKeyPrefix("gate", "st_1")).resolves.toBe(0);
    });

    test("writeCollectionが例外を投げても set は例外を投げない(書き込み失敗しても生成結果は使える)", async () => {
      const { writeCollection } = await import("@/lib/store/json-file-store");
      vi.mocked(writeCollection).mockImplementationOnce(() => {
        throw new Error("読み取り専用ファイルシステム");
      });
      const store = new JsonKvStore();

      await expect(
        store.set("gate", "st_1", "value", { ttlDays: null })
      ).resolves.toBeUndefined();
    });

    test("writeCollectionが例外を投げても deleteByKeyPrefix は例外を投げず0を返す", async () => {
      const store = new JsonKvStore();
      await store.set("gate", "st_1", "value", { ttlDays: null });
      const { writeCollection } = await import("@/lib/store/json-file-store");
      vi.mocked(writeCollection).mockImplementationOnce(() => {
        throw new Error("読み取り専用ファイルシステム");
      });

      await expect(store.deleteByKeyPrefix("gate", "st_1")).resolves.toBe(0);
    });

    test("writeCollectionが例外を投げても deleteOldestByKeyPrefix は例外を投げない", async () => {
      const store = new JsonKvStore();
      await store.set("gate", "st_1", "value", { ttlDays: null });
      const { writeCollection } = await import("@/lib/store/json-file-store");
      vi.mocked(writeCollection).mockImplementationOnce(() => {
        throw new Error("読み取り専用ファイルシステム");
      });

      await expect(store.deleteOldestByKeyPrefix("gate", "st_1")).resolves.toBeUndefined();
    });

    test("JSON.stringifyできない値(循環参照)を渡してもsetは例外を投げない", async () => {
      const store = new JsonKvStore();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const circular: any = {};
      circular.self = circular;

      await expect(
        store.set("gate", "st_1", circular, { ttlDays: null })
      ).resolves.toBeUndefined();
      await expect(store.get("gate", "st_1")).resolves.toBeNull();
    });
  });
});
