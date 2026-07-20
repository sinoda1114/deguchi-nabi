import { Suspense } from "react";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { resolveOriginDestination } from "@/lib/services/route-search-orchestrator";
import {
  resolveRouteCandidate,
  buildTrainSegments,
  buildTransferAndExitSegments,
} from "@/lib/services/route-search";
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
import { WarningBadge } from "@/components/diagram/WarningBadge";

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
}

/**
 * 経路名・所要時間・号車・出口を含む結果本体。origin/destinationの解決
 * (resolveOriginDestination)と経路候補の解決(resolveRouteCandidate、
 * AI生成を含み数秒〜数十秒かかりうる)をこの中で行う。
 * page.tsx側でSuspenseに包むことで、この解決を待つ間は
 * RouteResultBodySkeletonが表示され、検索直後に白い画面のまま止まって
 * 見えることを防ぐ(「検索画面が長い」というユーザーフィードバックに基づく)。
 */
export async function RouteResultBody({ origin, destination, mode, user }: RouteResultBodyProps) {
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

  // 経路候補自体(号車・改札・出口を除く骨格)が無ければ何も表示できないためawaitする。
  const candidate = await resolveRouteCandidate(searchInput, { routeProvider, stationProvider });

  if (!candidate.ok) {
    // 経路探索(AI/Web検索によるルート生成を含む)の失敗。
    // タイムアウトや一時的なAPI障害の可能性があり、生成失敗はキャッシュされない
    // ため再試行で成功しうる。
    return <ResultErrorMessage message={candidate.reason} retryable />;
  }

  // ここから先(号車・改札・出口情報)は Gemini 呼び出しを含み数秒〜数十秒かかりうるため、
  // await せず Promise のまま各セクションへ渡す。同じ Promise インスタンスは
  // 「生成元の処理を1回だけ表す」という JS の仕様上、複数コンポーネントで
  // 共有しても buildTrainSegments/buildTransferAndExitSegments が重複実行されることはない。
  const trainSegmentsPromise = buildTrainSegments(candidate.chosen, { stationProvider });
  const facilitiesPromise = buildTransferAndExitSegments(candidate, searchInput, {
    stationProvider,
  });

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
  if (user) {
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
        overviewContentNode={
          <Suspense fallback={<RouteOverviewContentSkeleton />}>
            <RouteOverviewContent
              trainSegmentsPromise={trainSegmentsPromise}
              facilitiesPromise={facilitiesPromise}
              mode={mode}
              transferCount={candidate.transferCount}
            />
          </Suspense>
        }
      />
      {candidate.routeWarnings.map((w, i) => (
        <WarningBadge key={i} text={w} />
      ))}
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
