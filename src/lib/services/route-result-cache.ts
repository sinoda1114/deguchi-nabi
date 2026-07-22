import { getKvCacheStore } from "@/lib/store/kv-cache-store";
import type { RouteCandidateResult, FacilitiesBuildSuccess } from "./route-search";
import type { RouteSegment } from "@/lib/domain/route";

/**
 * ページ結果(RouteResultBody)のリロード耐性キャッシュ。
 *
 * 背景: モバイルブラウザは、検索中にGoogle Mapsアプリ/タブへ離脱すると、
 * メモリ節約のためバックグラウンドタブを破棄することがある。ユーザーが
 * 戻ってきたときはタブの再読み込み(フルリロード)になり、単一呼び出しの
 * AI生成(最大数十秒〜100秒超)が最初からやり直しになっていた
 * (ユーザー報告、2026-07-22: 「リロードなんちゃら」でエラーのように見える)。
 *
 * PR #80(AI生成結果の永続キャッシュ撤去)との関係: PR #80は「異なるリクエスト・
 * 異なるユーザー間で古い生成結果を使い回さない」という決定だった。このキャッシュは
 * それとは目的が異なる: (a) 同一のrouteId(出発駅+到着駅+モード)かつ同一クライアント
 * (IPアドレス、下記buildReloadCacheKey参照)にしか使わない、(b) TTLを10分と短く
 * 保つ(ユーザー承認済み、2026-07-22)ことで、「同じ利用者がリロード直後に
 * 再生成させられる」問題の解消だけに用途を限定する。
 *
 * /ai-review指摘(Codex、High): 当初の実装はrouteIdのみをキーにしており、
 * 無関係な別ユーザーが同じ経路を10分以内に検索すると他人の生成結果を
 * 受け取れてしまっていた(PR #80が避けた「異なるユーザー間の再利用」の再導入)。
 * クライアントIPをキーに含めることで、実質的に「同じ利用者(端末)からの
 * 再アクセス」に絞り込む(page.tsxのIPレートリミットと同じextractClientIpを
 * 再利用。新しいセッションCookie基盤を作らずに済む現実的な折衷案)。同一IP
 * (社内LAN・公衆Wi-Fi等)を共有する別人が偶然同じ経路を10分以内に検索する
 * ケースは残るが、「同一IPかつ同一経路かつ10分以内」まで絞られた残存リスクは
 * 許容範囲と判断する(ユーザー承認、2026-07-22)。
 *
 * 保存先はTurso(getKvCacheStore、nearby-stationsキャッシュと同じ実装)を再利用する。
 * インメモリキャッシュを使わない理由: VercelのサーバーレスFunctionはリクエストごとに
 * 別インスタンス(コールドスタート)で処理されうるため、インメモリキャッシュは
 * 「戻ってくるまで同じインスタンスが温かいままか」に依存し、今回のように数分後に
 * 戻ってくるケースでは信頼できない(直ったように見えて実は直っていないことがある)。
 */

const ROUTE_RESULT_CACHE_COLLECTION = "route-result-reload-cache";

/**
 * TTL(分)。KvCacheStore.set の ttlDays は「日」単位のみを受け取るため、
 * 分から日への換算をこのファイル内に閉じる(呼び出し側は分だけ意識すればよい)。
 */
const ROUTE_RESULT_CACHE_TTL_MINUTES = 10;
const MINUTES_PER_DAY = 24 * 60;

export interface CachedRouteResultBundle {
  candidate: RouteCandidateResult;
  facilitiesResult: FacilitiesBuildSuccess;
  trainSegments: RouteSegment[];
}

/**
 * routeId(出発駅+到着駅+モード)とクライアントIPを組み合わせたキャッシュキー。
 * routeId単体をキーにしない理由は本ファイル冒頭のコメント参照。
 */
export function buildReloadCacheKey(routeId: string, clientIp: string): string {
  return `${routeId}::ip:${clientIp}`;
}

/**
 * キャッシュを読む。KvCacheStoreのgetはexpiresAtを見ずに値を返す設計
 * (stale-while-revalidateを呼び出し側に委ねるため、kv-cache-store.tsのJSDoc参照)
 * のため、ここで期限切れを明示的に判定してmiss扱いにする(このキャッシュは
 * 「短時間だけ再利用したい」用途であり、古い値を承知の上で返す設計にはしない)。
 *
 * /ai-review指摘(Codex、High): 当初の実装はexpiresAtがnullや不正な日時文字列
 * (パースするとNaN)の場合に「無期限に有効」として扱っていた。このキャッシュの
 * 安全境界は「短時間だけ」であるべきなので、expiresAtが存在し・有効な日時で・
 * 未来である場合のみヒットとするfail-closedに直す(欠損・不正値・過去はすべてmiss)。
 */
export async function getCachedRouteResult(cacheKey: string): Promise<CachedRouteResultBundle | null> {
  const entry = await getKvCacheStore().get<CachedRouteResultBundle>(
    ROUTE_RESULT_CACHE_COLLECTION,
    cacheKey
  );
  if (!entry) return null;
  if (!entry.expiresAt) return null;
  const expiresAtMs = new Date(entry.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) return null;
  return entry.value;
}

/**
 * キャッシュへ書き込む。呼び出し側はawaitせずfire-and-forgetで呼ぶ想定
 * (書き込み失敗・遅延で描画を遅らせないため。KvCacheStore自体もI/O失敗を
 * 握りつぶす設計なので、ここでの例外送出は無い)。
 */
export async function setCachedRouteResult(
  cacheKey: string,
  bundle: CachedRouteResultBundle
): Promise<void> {
  await getKvCacheStore().set(ROUTE_RESULT_CACHE_COLLECTION, cacheKey, bundle, {
    ttlDays: ROUTE_RESULT_CACHE_TTL_MINUTES / MINUTES_PER_DAY,
  });
}
