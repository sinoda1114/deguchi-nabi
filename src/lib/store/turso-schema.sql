-- Turso (libSQL) 永続ストアのスキーマ。
-- 適用方法: turso db shell <DB名> < src/lib/store/turso-schema.sql
-- (または turso db shell <DB名> で対話シェルに貼り付ける)
--
-- kv_cache: AIキャッシュ(改札・出口・号車・経路)の汎用KVストア。
--   collection でドメイン(用途)を分け、key で個別レコードを引く。
--   value_json は任意のJSONを文字列化して保持する。
--   verified_at はキャッシュを最後に検証/更新した時刻(ISO8601)。
--   expires_at はTTL失効時刻(ISO8601、TTL無しの場合はNULL)。
--   created_at は初回作成時刻(ISO8601、上書き更新では保持する)。
CREATE TABLE IF NOT EXISTS kv_cache (
  collection TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection, key)
);

-- rate_limit: レートリミット用(PR4で使用)。ここではDDLのみ用意する。
--   bucket はレート制限の単位(例: IP・ユーザー・エンドポイント)。
--   window_start は固定ウィンドウの開始時刻(epoch秒等の整数)。
--   count は当該ウィンドウ内のカウント。
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
