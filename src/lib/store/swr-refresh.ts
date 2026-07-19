import { after } from "next/server";

/**
 * stale-while-revalidate用の共通ユーティリティ。
 *
 * KvCacheStore(kv-cache-store.ts)は期限切れをmiss扱いにせず、expiresAtを
 * 添えてそのまま返す設計になっている(PR1)。呼び出し側(各アダプター)は
 * 期限切れでも古い値を即座にユーザーへ返しつつ、裏で再生成して上書きする
 * ことでレイテンシと鮮度のトレードオフを両立する(PR3)。
 *
 * 正直な限界: 再生成が継続的に失敗し続けた場合(AI/外部API障害、駅解決不可
 * 等)、キャッシュは更新されないまま古い値を無期限に返し続ける
 * (/ai-review指摘、Medium)。同期的な失敗処理やキャッシュ自体の無効化は
 * 「レイテンシを犠牲にせず鮮度を上げる」というSWRの目的そのものと矛盾する
 * ため採用しない。再生成失敗はconsole.errorに残るため観測は可能(監視・
 * アラート化はこのPRのスコープ外)。実害は「工事等による出口変更が
 * facilities/boarding/arrival-guideで最大90日、rail-routesで最大180日
 * 反映されない」程度で、無期限に肥大化するような性質の問題ではないため
 * 現時点では許容する。将来的にfeedback起点のadminキャッシュ無効化(PR8)が
 * 入れば、再生成失敗が続くケースの実質的な救済経路になる。
 */

/**
 * 同一キーへの裏再生成の多重実行を防ぐプロセス内ガード。
 *
 * サーバーレス環境(Vercel)では複数インスタンスが並行動作するため、
 * インスタンスをまたいだ二重生成は完全には防げない。ただし裏再生成は
 * 「同じキーへの冪等な上書き」(生成結果をそのままstore.setするだけで、
 * 新規キーの追加やLRU evictionは伴わない)であるため、稀に二重生成が
 * 起きても実害は「同じAPI呼び出しが1回余分に走る」程度で許容する。
 */
const inFlightRefreshKeys = new Set<string>();

function safeErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "unknown error";
}

/**
 * KvEntry.expiresAt(ISO8601、無期限はnull)を元に期限切れかどうかを判定する。
 *
 * 不正な日時文字列(Date.parseがNaNを返す)は期限切れとして扱う
 * (/ai-review指摘、Low)。NaN < Date.now() は常にfalseになるため、
 * 何もしないと「壊れた値ほど無期限に新鮮扱いされる」という直感に反する
 * 挙動になる。KvCacheStoreの実装は自前でISO文字列を生成するため通常は
 * 発生しないが、防御的に安全側(=再生成される側)へ倒す。
 */
export function isCacheEntryExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs < Date.now();
}

/**
 * 期限切れエントリの裏再生成をスケジュールする(fire-and-forget)。
 * 呼び出し元はstale値を即座に返した後にこれを呼ぶ想定で、再生成の完了を
 * 待たない。
 *
 * langfuse-flush.tsと同じ二重try/catch構造を踏襲する:
 * 1. after()自体の同期例外(Next.jsのリクエストコンテキスト外、テスト実行時等)
 *    は外側のtry/catchで捕捉する。stale値は既に返せているため、再生成を
 *    諦めても機能上の問題はない。
 * 2. refreshコールバックの非同期拒否(AI生成・ストア書き込みの失敗)は、
 *    afterのコールバック内側で個別にtry/catchする(外側の同期try/catchでは
 *    捕捉できないため)。
 */
export function scheduleStaleRefresh(refreshKey: string, refresh: () => Promise<void>): void {
  if (inFlightRefreshKeys.has(refreshKey)) return;
  inFlightRefreshKeys.add(refreshKey);

  try {
    after(async () => {
      try {
        await refresh();
      } catch (e) {
        console.error(`[swr-refresh] 裏再生成失敗(無視): ${refreshKey}`, safeErrorMessage(e));
      } finally {
        inFlightRefreshKeys.delete(refreshKey);
      }
    });
  } catch (e) {
    inFlightRefreshKeys.delete(refreshKey);
    console.error(
      `[swr-refresh] after()が同期的に失敗、再生成をスキップ: ${refreshKey}`,
      safeErrorMessage(e)
    );
  }
}
