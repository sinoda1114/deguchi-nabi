import { JsonKvStore } from "./json-kv-store";
import { TursoKvStore } from "./turso-kv-store";

/**
 * KVキャッシュの1エントリ。value は任意のJSON、verifiedAt/expiresAt はISO8601。
 *
 * このストア層はexpiresAtを保存・返却するだけで、期限切れをmiss扱いにはしない
 * (/ai-review指摘、Low)。期限切れでも古い値を即返しつつ裏で再生成する
 * stale-while-revalidate(PR3で実装予定)を呼び出し側が行うための設計。
 * ストア層でmiss扱いにすると、PR3で「古い値を即返す」ことができなくなる。
 */
export interface KvEntry<T> {
  value: T;
  verifiedAt: string;
  expiresAt: string | null;
}

/**
 * AIキャッシュ(改札・出口・号車・経路)の汎用KVストア。
 * collection でドメインを分け、key で個別レコードを引く。
 * 実装は Turso(本番) または ローカルJSON(開発・フォールバック)。
 */
export interface KvCacheStore {
  get<T>(collection: string, key: string): Promise<KvEntry<T> | null>;
  set<T>(
    collection: string,
    key: string,
    value: T,
    opts: { ttlDays: number | null }
  ): Promise<void>;
  /** 前方一致で削除し、削除件数を返す。 */
  deleteByKeyPrefix(collection: string, prefix: string): Promise<number>;
  /** 前方一致の件数を返す。 */
  countByKeyPrefix(collection: string, prefix: string): Promise<number>;
  /** 前方一致の中で created_at 最古の1件を削除する。 */
  deleteOldestByKeyPrefix(collection: string, prefix: string): Promise<void>;
}

declare global {
  var __kvCacheStore: KvCacheStore | undefined;
  var __kvCacheStoreFallbackWarned: boolean | undefined;
}

function hasTursoEnv(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL) && Boolean(process.env.TURSO_AUTH_TOKEN);
}

function createStore(): KvCacheStore {
  if (hasTursoEnv()) {
    return new TursoKvStore();
  }
  if (process.env.NODE_ENV === "production" && !globalThis.__kvCacheStoreFallbackWarned) {
    globalThis.__kvCacheStoreFallbackWarned = true;
    console.warn(
      "[kv-cache-store] TURSO_DATABASE_URL/TURSO_AUTH_TOKEN が未設定のため" +
        "ローカルJSONストアにフォールバックします。本番の読み取り専用FSでは" +
        "キャッシュが永続化されず、AIの再生成コストが発生します。"
    );
  }
  return new JsonKvStore();
}

/**
 * KVストアのシングルトンを返す。
 * globalThis にメモ化して Next.js/Turbopack の二重モジュール評価でも
 * 同一インスタンスを共有する(instrumentation.ts と同じ発想)。
 */
export function getKvCacheStore(): KvCacheStore {
  if (!globalThis.__kvCacheStore) {
    globalThis.__kvCacheStore = createStore();
  }
  return globalThis.__kvCacheStore;
}
