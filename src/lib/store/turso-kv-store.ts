import type { KvCacheStore, KvEntry } from "./kv-cache-store";
import { getTursoClient } from "./turso-client";

/**
 * KvCacheStore の Turso(libSQL)実装。
 *
 * エラー方針: Turso I/O(ネットワーク/DB)失敗、および壊れた行の JSON.parse 失敗は
 * try/catch で握りつぶし console.error する。get は null、
 * set/delete は安全側(既存方針「キャッシュ障害でも本体は動く」に従う)。
 * こうすることで、キャッシュ層の一時障害や壊れた1行が本体機能を巻き込まない。
 */

const TABLE = "kv_cache";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// LIKE のエスケープ文字。前方一致を「リテラル一致」にするために使う。
const LIKE_ESCAPE_CHAR = "\\";

function addDaysIso(fromIso: string, days: number): string {
  return new Date(new Date(fromIso).getTime() + days * MS_PER_DAY).toISOString();
}

/**
 * prefix を LIKE のリテラル前方一致パターンに変換する。
 * LIKE のワイルドカード(% _)とエスケープ文字自体を \ でエスケープし、末尾に % を付ける。
 * stationId は "hr_横浜_139.6199_35.4658" のように '_' を含むため、素の LIKE では
 * '_' が任意1文字として扱われ、別駅のキーへ誤マッチ(駅単位無効化で無関係な駅の
 * キャッシュを巻き込む)しうる。json-kv-store の startsWith 実装と挙動を揃えるためにも
 * 必須。SQL 側では `LIKE ? ESCAPE '\'` と組で使う。
 */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, "\\$&") + "%";
}

export class TursoKvStore implements KvCacheStore {
  async get<T>(collection: string, key: string): Promise<KvEntry<T> | null> {
    try {
      const rs = await getTursoClient().execute(
        `SELECT value_json, verified_at, expires_at FROM ${TABLE} WHERE collection = ? AND key = ? LIMIT 1`,
        [collection, key]
      );
      const row = rs.rows[0];
      if (!row) return null;
      return {
        value: JSON.parse(row.value_json as string) as T,
        verifiedAt: row.verified_at as string,
        expiresAt: (row.expires_at as string | null) ?? null,
      };
    } catch (error) {
      console.error(`[turso-kv-store] get 失敗: ${collection}/${key}`, error);
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
      const now = new Date().toISOString();
      const expiresAt = opts.ttlDays != null ? addDaysIso(now, opts.ttlDays) : null;
      // created_at は初回のみ保持したいので ON CONFLICT では更新しない。
      await getTursoClient().execute(
        `INSERT INTO ${TABLE} (collection, key, value_json, verified_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(collection, key) DO UPDATE SET
           value_json = excluded.value_json,
           verified_at = excluded.verified_at,
           expires_at = excluded.expires_at`,
        [collection, key, JSON.stringify(value), now, expiresAt, now]
      );
    } catch (error) {
      console.error(`[turso-kv-store] set 失敗: ${collection}/${key}`, error);
    }
  }

  async deleteByKeyPrefix(collection: string, prefix: string): Promise<number> {
    try {
      const rs = await getTursoClient().execute(
        `DELETE FROM ${TABLE} WHERE collection = ? AND key LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}'`,
        [collection, escapeLikePrefix(prefix)]
      );
      return rs.rowsAffected;
    } catch (error) {
      console.error(`[turso-kv-store] deleteByKeyPrefix 失敗: ${collection}/${prefix}`, error);
      return 0;
    }
  }

  async countByKeyPrefix(collection: string, prefix: string): Promise<number> {
    try {
      const rs = await getTursoClient().execute(
        `SELECT COUNT(*) AS count FROM ${TABLE} WHERE collection = ? AND key LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}'`,
        [collection, escapeLikePrefix(prefix)]
      );
      const row = rs.rows[0];
      return row ? Number(row.count) : 0;
    } catch (error) {
      console.error(`[turso-kv-store] countByKeyPrefix 失敗: ${collection}/${prefix}`, error);
      return 0;
    }
  }

  async deleteOldestByKeyPrefix(collection: string, prefix: string): Promise<void> {
    try {
      await getTursoClient().execute(
        `DELETE FROM ${TABLE}
         WHERE collection = ? AND key = (
           SELECT key FROM ${TABLE}
           WHERE collection = ? AND key LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}'
           ORDER BY created_at ASC
           LIMIT 1
         )`,
        [collection, collection, escapeLikePrefix(prefix)]
      );
    } catch (error) {
      console.error(`[turso-kv-store] deleteOldestByKeyPrefix 失敗: ${collection}/${prefix}`, error);
    }
  }
}
