import { getTursoClient } from "@/lib/store/turso-client";

/**
 * IPベースのレートリミット(fixed-window方式)。
 *
 * 未認証かつAI課金が発生するエンドポイント(/api/routes/search、経路結果RSC)を
 * Serperクレジット枯渇等の濫用/DoSから守るための防壁(PR4)。
 *
 * 可用性優先の方針: Turso未設定または実行時エラーの場合は fail-open
 * (allowed: true)とする。既存のキャッシュ層(turso-kv-store.ts)と同じ
 * 「障害時にサービスを落とさない」方針に揃える。レートリミットが機能しない
 * ことよりも、レートリミットの一時障害でアプリ全体が止まることの方が悪い。
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_SECONDS = 60;

// 掃除(古いwindowの行削除)の発火確率。毎回律儀に掃除するとレスポンスの
// クリティカルパスに余計なDB往復が増えるため、確率的に間引く。
const CLEANUP_PROBABILITY = 0.01;
// 掃除で削除する行の閾値。このPRで使う最長のウィンドウ(日次60req/86400秒)より
// 十分長く保持し、集計中の行を誤って消さないようにする。
const CLEANUP_RETENTION_SECONDS = 2 * 24 * 60 * 60; // 2日

function hasTursoEnv(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL) && Boolean(process.env.TURSO_AUTH_TOKEN);
}

/**
 * 確率的に古いwindowの行を掃除する。fire-and-forget(呼び出し元をブロックしない)。
 * 例外は握りつぶす(掃除の失敗が本体のレートリミット判定に影響してはならない)。
 */
function maybeCleanup(nowSeconds: number): void {
  if (Math.random() >= CLEANUP_PROBABILITY) return;

  try {
    const staleThreshold = nowSeconds - CLEANUP_RETENTION_SECONDS;
    void getTursoClient()
      .execute(`DELETE FROM rate_limit WHERE window_start < ?`, [staleThreshold])
      .catch((error) => {
        console.error(`[ip-rate-limit] 掃除(cleanup)失敗(無視): threshold=${staleThreshold}`, error);
      });
  } catch (error) {
    console.error("[ip-rate-limit] 掃除(cleanup)の起動に失敗(無視)", error);
  }
}

/**
 * IP単位のfixed-windowレートリミットを判定する。
 * bucket = `${scope}:${ip}` 単位、windowSeconds ごとの固定ウィンドウでカウントする。
 */
export async function checkIpRateLimit(
  ip: string,
  scope: string,
  opts?: { limit?: number; windowSeconds?: number }
): Promise<RateLimitResult> {
  if (!hasTursoEnv()) {
    return { allowed: true };
  }

  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const windowSeconds = opts?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const bucket = `${scope}:${ip}`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;

  try {
    const rs = await getTursoClient().execute(
      `INSERT INTO rate_limit (bucket, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
      [bucket, windowStart]
    );

    const row = rs.rows[0];
    const count = row ? Number(row.count) : 1;

    maybeCleanup(nowSeconds);

    if (count > limit) {
      const windowEndSeconds = windowStart + windowSeconds;
      const retryAfterSeconds = Math.max(1, windowEndSeconds - nowSeconds);
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true };
  } catch (error) {
    console.error(`[ip-rate-limit] checkIpRateLimit 失敗(fail-open): ${bucket}`, error);
    return { allowed: true };
  }
}

/**
 * /api/routes/search と経路結果RSC(routes/result/page.tsx)で共有する
 * レートリミットポリシー: 分間上限(バースト対策)と日次上限(累積対策)の
 * 両方をチェックする。分間チェックで既に制限超過なら日次チェックの
 * Turso呼び出しは省略する(早期return)。
 *
 * 正直な限界: fixed-window方式のため、日次ウィンドウの境界(UTC日付変更)
 * 直前に60回・直後に60回実行すると短時間で最大120回まで通りうる
 * (/ai-review指摘、Medium)。「暦日ごとに60回まで」という素朴な運用は
 * 保証されるが、「任意の24時間で60回まで」という厳密な保証ではない。
 * Serperクレジット枯渇の防壁という目的に対しては許容範囲(2倍程度の
 * バーストで即座に予算が尽きるわけではない)と判断し、sliding window等の
 * 複雑な実装は見送る。
 */
// 一時的に上限を緩和(2026-07-21、experiment/destination-fix-then-vote検証用)。
// このブランチは本番マージ対象外の検証専用ブランチのため一時変更してよいが、
// 本番反映するブランチへは絶対に持ち込まないこと(元の10/60・60/86400に戻す)。
export async function checkRoutesSearchRateLimit(ip: string): Promise<RateLimitResult> {
  const perMinute = await checkIpRateLimit(ip, "routes-search", { limit: 100, windowSeconds: 60 });
  if (!perMinute.allowed) return perMinute;

  return checkIpRateLimit(ip, "routes-search-daily", { limit: 1000, windowSeconds: 86400 });
}

// IPv6の最長表記(45文字程度)に十分な余裕を持たせた上限。ヘッダは外部から
// 任意の値を送り込めるため、異常に長い値をbucket文字列・DBの行・ログに
// そのまま使わないよう切り詰める(/ai-review指摘、Low)。
const MAX_IP_LENGTH = 64;

/**
 * Headers からクライアントIPを抽出する。
 * x-forwarded-for の先頭値(Vercelが信頼できる値を先頭に設定する)を優先し、
 * 無ければ x-real-ip、どちらも無ければ "unknown" に落とす(開発環境等、
 * ヘッダが無いケースへのフォールバック。この場合 "unknown" という単一バケットに
 * 積み上がるが、許容する)。
 */
export function extractClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first.slice(0, MAX_IP_LENGTH);
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed.slice(0, MAX_IP_LENGTH);
  }

  return "unknown";
}
