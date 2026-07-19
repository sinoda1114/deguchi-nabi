import type { KvCacheStore, KvEntry } from "./kv-cache-store";
import { readCollection, writeCollection } from "./json-file-store";

/**
 * ローカルJSON実装(開発・段階導入・Turso未設定時のフォールバック)。
 * json-file-store(同期API)を内部で使い、collection ごとに `kv-<collection>` という
 * ファイル名で `JsonKvRow` の配列として保存する。
 * KvCacheStore は async だが、内部実装は同期I/Oを async でラップしているだけ。
 */

interface JsonKvRow {
  key: string;
  value_json: string;
  verifiedAt: string;
  expiresAt: string | null;
  createdAt: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function collectionName(collection: string): string {
  return `kv-${collection}`;
}

function addDaysIso(fromIso: string, days: number): string {
  return new Date(new Date(fromIso).getTime() + days * MS_PER_DAY).toISOString();
}

/**
 * キャッシュは最適化にすぎず、必須要件ではない(既存の json-file-store 呼び出し元
 * 全般と同じ方針)。readCollection/writeCollection のI/O失敗(本番の読み取り専用
 * ファイルシステム等)や JSON.stringify/parse の失敗(壊れた行・循環参照値)は
 * ここで握りつぶし、呼び出し元(本体機能)を巻き込まない。Turso実装(turso-kv-store.ts)
 * と同じエラー方針(/ai-review指摘、High)。
 */
export class JsonKvStore implements KvCacheStore {
  async get<T>(collection: string, key: string): Promise<KvEntry<T> | null> {
    try {
      const rows = readCollection<JsonKvRow>(collectionName(collection));
      const row = rows.find((r) => r.key === key);
      if (!row) return null;
      return {
        value: JSON.parse(row.value_json) as T,
        verifiedAt: row.verifiedAt,
        expiresAt: row.expiresAt,
      };
    } catch (error) {
      console.error(`[json-kv-store] get 失敗: ${collection}/${key}`, error);
      return null;
    }
  }

  async set<T>(
    collection: string,
    key: string,
    value: T,
    opts: { ttlDays: number | null }
  ): Promise<void> {
    try {
      const name = collectionName(collection);
      const rows = readCollection<JsonKvRow>(name);
      const now = new Date().toISOString();
      const existing = rows.find((r) => r.key === key);
      const nextRow: JsonKvRow = {
        key,
        value_json: JSON.stringify(value),
        verifiedAt: now,
        expiresAt: opts.ttlDays != null ? addDaysIso(now, opts.ttlDays) : null,
        // created_at は初回のみ保持する(上書き更新では既存値を引き継ぐ)。
        createdAt: existing?.createdAt ?? now,
      };
      const next = [...rows.filter((r) => r.key !== key), nextRow];
      writeCollection(name, next);
    } catch (error) {
      console.error(`[json-kv-store] set 失敗: ${collection}/${key}`, error);
    }
  }

  async deleteByKeyPrefix(collection: string, prefix: string): Promise<number> {
    try {
      const name = collectionName(collection);
      const rows = readCollection<JsonKvRow>(name);
      const remaining = rows.filter((r) => !r.key.startsWith(prefix));
      const deleted = rows.length - remaining.length;
      if (deleted > 0) writeCollection(name, remaining);
      return deleted;
    } catch (error) {
      console.error(`[json-kv-store] deleteByKeyPrefix 失敗: ${collection}/${prefix}`, error);
      return 0;
    }
  }

  async countByKeyPrefix(collection: string, prefix: string): Promise<number> {
    try {
      const rows = readCollection<JsonKvRow>(collectionName(collection));
      return rows.filter((r) => r.key.startsWith(prefix)).length;
    } catch (error) {
      console.error(`[json-kv-store] countByKeyPrefix 失敗: ${collection}/${prefix}`, error);
      return 0;
    }
  }

  async deleteOldestByKeyPrefix(collection: string, prefix: string): Promise<void> {
    try {
      const name = collectionName(collection);
      const rows = readCollection<JsonKvRow>(name);
      const matches = rows.filter((r) => r.key.startsWith(prefix));
      if (matches.length === 0) return;
      const oldest = matches.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      writeCollection(
        name,
        rows.filter((r) => r.key !== oldest.key)
      );
    } catch (error) {
      console.error(`[json-kv-store] deleteOldestByKeyPrefix 失敗: ${collection}/${prefix}`, error);
    }
  }
}
