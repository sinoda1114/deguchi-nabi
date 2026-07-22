import { Suspense } from "react";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { resolveOriginDestination } from "@/lib/services/route-search-orchestrator";
import {
  resolveRouteCandidate,
  buildTrainSegments,
  buildTransferAndExitSegments,
  approximateWalkingDistanceMeters,
  estimateWalkingMinutes,
  buildRouteId,
} from "@/lib/services/route-search";
import type { FacilitiesSearchResult, RouteCandidateResult } from "@/lib/services/route-search";
import {
  getCachedRouteResult,
  setCachedRouteResult,
  buildReloadCacheKey,
} from "@/lib/services/route-result-cache";
import { addHistoryEntry } from "@/lib/store/history-repository";
import { buildReturnRouteUrl } from "@/lib/services/return-route-link";
import type { AccessibilityCondition, RouteMode } from "@/lib/domain/route";
import { routeProvider, stationProvider, placeProvider } from "@/lib/integrations";
import { ResultErrorMessage } from "@/components/result/ResultErrorMessage";
import { RouteOverviewCard } from "@/components/result/RouteOverviewCard";
import { RouteOverviewContent } from "@/components/result/RouteOverviewContent";
import { RouteOverviewContentSkeleton } from "@/components/result/RouteOverviewContentSkeleton";
import { RouteTimelineDiagramSection } from "@/components/result/RouteTimelineDiagramSection";
import { RouteTimelineDiagramSectionSkeleton } from "@/components/result/RouteTimelineDiagramSectionSkeleton";
import { RouteDiagramSection } from "@/components/result/RouteDiagramSection";
import { RouteDiagramSectionSkeleton } from "@/components/result/RouteDiagramSectionSkeleton";
import { FacilitiesWarningBadges } from "@/components/result/FacilitiesWarningBadges";
import { ConfidenceSummarySection } from "@/components/result/ConfidenceSummarySection";
import { ConfidenceSummarySectionSkeleton } from "@/components/result/ConfidenceSummarySectionSkeleton";
import { WarningBadgeList } from "@/components/diagram/WarningBadgeList";

const DEFAULT_ACCESSIBILITY: AccessibilityCondition = {
  avoidStairs: false,
  preferElevator: false,
  preferEscalator: false,
};

interface RouteResultBodyProps {
  origin:
    | { type: "home_station" }
    | { type: "station"; stationId: string };
  destination:
    | { type: "place"; placeId: string }
    | { type: "station"; stationId: string };
  mode: RouteMode;
  user: Awaited<ReturnType<typeof getSessionUser>>;
  /**
   * リロード耐性キャッシュ(route-result-cache.ts)のキーにIPアドレスを含めるため
   * page.tsxから受け取る(既にIPレートリミットで取得済みのextractClientIpの結果を
   * 再利用し、二重取得しない)。routeId単体をキーにすると、無関係な別ユーザーが
   * 同じ経路を10分以内に検索した場合に他人の生成結果を受け取れてしまうため
   * (/ai-review指摘、Codex参照)。
   */
  clientIp: string;
}

/**
 * 経路名・所要時間・号車・出口を含む結果本体。origin/destinationの解決
 * (resolveOriginDestination)と経路候補の解決(resolveRouteCandidate、
 * AI生成を含み数秒〜数十秒かかりうる)をこの中で行う。
 * page.tsx側でSuspenseに包むことで、この解決を待つ間は
 * RouteResultBodySkeletonが表示され、検索直後に白い画面のまま止まって
 * 見えることを防ぐ(「検索画面が長い」というユーザーフィードバックに基づく)。
 */
export async function RouteResultBody({ origin, destination, mode, user, clientIp }: RouteResultBodyProps) {
  // origin/destination の解決(stationId特定)は経路全体の解決より軽いため先にawaitする。
  // これが失敗する場合、経路自体を組み立てられずストリーミング表示のしようがない。
  const resolved = await resolveOriginDestination(
    { origin, destination },
    user,
    { stationProvider, placeProvider }
  );

  if (!resolved.ok) {
    // 駅・施設のID自体が解決できないケース(確定的な失敗)。再試行しても結果は変わらない。
    return <ResultErrorMessage message={resolved.error} />;
  }

  const searchInput = {
    originStationId: resolved.originStationId,
    originLabel: resolved.originLabel,
    destinationStationId: resolved.destinationStationId,
    destinationLabel: resolved.destinationLabel,
    destinationCoordinates: resolved.destinationCoordinates,
    mode,
    accessibility: DEFAULT_ACCESSIBILITY,
  };

  // リロード耐性キャッシュ(2026-07-22追加)。モバイルブラウザは検索中に
  // Google Mapsアプリ/タブへ離脱すると、メモリ節約のためバックグラウンドタブを
  // 破棄することがあり、戻ってきたときのフルリロードでAI生成(最大数十秒〜
  // 100秒超)が最初からやり直しになっていた(ユーザー報告)。routeId(出発駅+
  // 到着駅+モード)をキーに、直近10分以内の同じ検索結果があればそれを使う
  // (route-result-cache.tsのJSDoc参照。PR #80が撤去した「異なるリクエスト間の
  // 使い回し」とは異なり、同一routeId・短TTLに限定したユーザー承認済みの設計)。
  const routeId = buildRouteId(resolved.originStationId, resolved.destinationStationId, mode);
  const cacheKey = buildReloadCacheKey(routeId, clientIp);
  const cached = await getCachedRouteResult(cacheKey);

  let candidate: RouteCandidateResult;
  let facilitiesPromise: Promise<FacilitiesSearchResult>;
  let trainSegmentsPromise: ReturnType<typeof buildTrainSegments>;

  if (cached) {
    candidate = cached.candidate;
    facilitiesPromise = Promise.resolve({ ok: true, result: cached.facilitiesResult });
    trainSegmentsPromise = Promise.resolve(cached.trainSegments);
  } else {
    // 経路候補自体(号車・改札・出口を除く骨格)が無ければ何も表示できないためawaitする。
    const candidateResult = await resolveRouteCandidate(searchInput, { routeProvider, stationProvider });

    if (!candidateResult.ok) {
      // 経路探索(AI/Web検索によるルート生成を含む)の失敗。
      // タイムアウトや一時的なAPI障害の可能性があり、生成失敗はキャッシュされない
      // ため再試行で成功しうる。
      return <ResultErrorMessage message={candidateResult.reason} retryable />;
    }
    candidate = candidateResult;

    // ここから先(号車・改札・出口情報)は Gemini 呼び出しを含み数秒〜数十秒かかりうるため、
    // await せず Promise のまま各セクションへ渡す。同じ Promise インスタンスは
    // 「生成元の処理を1回だけ表す」という JS の仕様上、複数コンポーネントで
    // 共有しても buildTrainSegments/buildTransferAndExitSegments が重複実行されることはない。
    //
    // accessibleモードは統合生成を使わない(route-search.ts canTryUnified参照)
    // ため、両者を独立実行する(Phase 3時点の並列動作を維持)。
    //
    // accessible以外のモードはtrainSegmentsPromiseがfacilitiesPromiseの解決を
    // .then()で待ってからbuildTrainSegmentsを呼ぶ(2026-07-20
    // fix/unified-guide-boarding-and-operator-disambiguation)。統合生成
    // (facilitiesPromise内)がgateを基準に決めた乗車位置をbuildTrainSegments
    // へ渡すことで、両者が無関係な改札を基準にした号車を独立に返してしまう
    // 不整合を防ぐ(西谷駅→横浜駅の実機検証で確認済みの不具合)。通常ケース
    // (統合生成成功時)ではbuildTrainSegments自体は追加のAI呼び出しをしない
    // ため、直列化による体感速度への影響は小さい(route-search.ts
    // searchRouteGuideの並列/直列分岐、maxDurationのコメントも参照)。
    facilitiesPromise = buildTransferAndExitSegments(candidate, searchInput, {
      stationProvider,
    });
    trainSegmentsPromise =
      mode === "accessible"
        ? buildTrainSegments(candidate.chosen, { stationProvider })
        : facilitiesPromise.then((outcome) =>
            buildTrainSegments(
              candidate.chosen,
              { stationProvider },
              outcome.ok ? outcome.result.unifiedBoardingPosition : null
            )
          );

    // 生成が両方成功した場合のみリロード耐性キャッシュへ書き込む(失敗結果は
    // 保存しない)。描画を遅らせないよう await せず fire-and-forget にする。
    // どちらかのPromiseがreject(例外)した場合に未処理rejection警告を出さないよう
    // 明示的に握りつぶす(single-call-navigator.tsのgetSharedSingleCallNavigator
    // Guideと同じ防御パターン)。facilitiesPromise/trainSegmentsPromise自体は
    // 呼び出し元(Suspense配下の各コンポーネント)が別途subscribeするため、
    // ここでcatchしても呼び出し元の例外処理には影響しない。
    Promise.all([facilitiesPromise, trainSegmentsPromise])
      .then(([facilitiesResult, trainSegments]) => {
        if (!facilitiesResult.ok) return;
        return setCachedRouteResult(cacheKey, {
          candidate,
          facilitiesResult: facilitiesResult.result,
          trainSegments,
        });
      })
      .catch(() => {});
  }

  // accessible(バリアフリー)モードは、エレベーター情報を確認できない経路を
  // 「利用可能な経路」に見せてはならない(安全に関わる)。buildTransferAndExitSegments は
  // accessible かつエレベーター未確認の場合のみ ok:false を返すため、この場合だけ
  // facilities の解決を待ってから成立可否を判定し、失敗ならページ全体をエラー表示にする
  // (号車・改札・出口を部分的にストリーミング表示すると、バリアフリー経路として
  // 使えるかのように誤認させる恐れがあるため)。
  if (mode === "accessible") {
    const facilitiesResult = await facilitiesPromise;
    if (!facilitiesResult.ok) {
      // 改札・出口・エレベーター情報の生成(Gemini呼び出し含む)の失敗。
      // 生成失敗はキャッシュされないため、再試行で情報が確認できるようになる可能性がある。
      return <ResultErrorMessage message={facilitiesResult.reason} retryable />;
    }
  }

  // 履歴保存は「案内として成立した経路」だけを対象にする(/api/routes/search の
  // resolveAndSearchRoute と同じ不変条件)。easy/fastest モードは
  // buildTransferAndExitSegments が ok:false を返すことがないため、facilities の
  // 解決を待たずにここで保存してよい(ストリーミング表示を妨げない)。
  // キャッシュヒット時(リロード等)は既に同じ検索を履歴保存済みのはずのため、
  // 重複保存しないようスキップする。
  if (user && !cached) {
    try {
      addHistoryEntry({
        userId: user.userId,
        routeGuideId: candidate.routeId,
        originLabel: resolved.originLabel,
        destinationLabel: resolved.destinationLabel,
        mode,
        query: {
          originStationId: resolved.originStationId,
          destinationStationId: resolved.destinationStationId,
          mode,
        },
      });
    } catch (error) {
      console.error("Failed to save history entry:", error);
    }
  }

  // 出口から目的地までの徒歩時間(概算)。直線距離(近似値)ベースのため
  // 実際より短く出うる目安(route-search.tsのJSDoc参照)。目的地が駅そのもの
  // (destinationCoordinatesが無い)場合はnullのまま、乗車時間のみ表示する。
  const walkingMinutes = estimateWalkingMinutes(
    approximateWalkingDistanceMeters(candidate.arrivalStationCoordinates, resolved.destinationCoordinates)
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
      <RouteOverviewCard
        mode={mode}
        routeId={candidate.routeId}
        originName={candidate.originName}
        destinationName={candidate.destinationName}
        originStationId={resolved.originStationId}
        destinationStationId={resolved.destinationStationId}
        canSave={Boolean(user)}
        estimatedDurationMinutes={candidate.estimatedDurationMinutes}
        walkingMinutes={walkingMinutes}
        overviewContentNode={
          <Suspense fallback={<RouteOverviewContentSkeleton />}>
            <RouteOverviewContent
              trainSegmentsPromise={trainSegmentsPromise}
              facilitiesPromise={facilitiesPromise}
              transferCount={candidate.transferCount}
              destinationCoordinates={resolved.destinationCoordinates}
            />
          </Suspense>
        }
      />
      <WarningBadgeList texts={candidate.routeWarnings} />
      <Suspense fallback={null}>
        <FacilitiesWarningBadges facilitiesPromise={facilitiesPromise} />
      </Suspense>

      <section>
        <h2 className="mb-3 text-xs font-bold text-[var(--foreground-muted)]">
          ルートの流れ
        </h2>
        <Suspense fallback={<RouteTimelineDiagramSectionSkeleton />}>
          <RouteTimelineDiagramSection
            trainSegmentsPromise={trainSegmentsPromise}
            facilitiesPromise={facilitiesPromise}
            destinationName={candidate.destinationName}
          />
        </Suspense>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">
          ルート
        </h2>
        <Suspense fallback={<RouteDiagramSectionSkeleton />}>
          <RouteDiagramSection
            trainSegmentsPromise={trainSegmentsPromise}
            facilitiesPromise={facilitiesPromise}
          />
        </Suspense>
      </section>

      <Suspense fallback={<ConfidenceSummarySectionSkeleton />}>
        <ConfidenceSummarySection
          trainSegmentsPromise={trainSegmentsPromise}
          facilitiesPromise={facilitiesPromise}
          mode={mode}
        />
      </Suspense>

      <Link
        href={`/chat?routeGuideId=${candidate.routeId}`}
        className="rounded-[var(--radius-card)] bg-[var(--accent)] py-3 text-center text-sm font-bold text-[var(--accent-foreground)] hover:opacity-90"
      >
        この案内について質問する
      </Link>

      <Link
        href={`/feedback?routeGuideId=${candidate.routeId}`}
        className="rounded-[var(--radius-card)] border border-[var(--border)] py-3 text-center text-sm font-bold text-[var(--foreground-muted)] hover:border-[var(--accent)] hover:text-[var(--foreground)]"
      >
        この案内の情報が違う場合はこちら
      </Link>

      <Link
        href={buildReturnRouteUrl(resolved.originStationId, resolved.destinationStationId, mode)}
        className="rounded-[var(--radius-card)] border border-[var(--border)] py-3 text-center text-sm font-bold text-[var(--foreground-muted)] hover:border-[var(--accent)] hover:text-[var(--foreground)]"
      >
        帰りのルートを見る
      </Link>
    </main>
  );
}
