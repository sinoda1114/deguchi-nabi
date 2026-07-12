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
import type { AccessibilityCondition, RouteMode } from "@/lib/domain/route";
import { routeProvider, stationProvider, placeProvider } from "@/lib/integrations";
import { AppHeader } from "@/components/layout/AppHeader";
import { KeyInstructionCard } from "@/components/result/KeyInstructionCard";
import { KeyInstructionText } from "@/components/result/KeyInstructionText";
import { KeyInstructionTextSkeleton } from "@/components/result/KeyInstructionTextSkeleton";
import { RouteSummaryCard } from "@/components/result/RouteSummaryCard";
import { RecommendedExitValue } from "@/components/result/RecommendedExitValue";
import { RecommendedExitValueSkeleton } from "@/components/result/RecommendedExitValueSkeleton";
import { TrainSegmentList } from "@/components/result/TrainSegmentList";
import { TrainSegmentListSkeleton } from "@/components/result/TrainSegmentListSkeleton";
import { TransferExitSegmentList } from "@/components/result/TransferExitSegmentList";
import { TransferExitSegmentListSkeleton } from "@/components/result/TransferExitSegmentListSkeleton";
import { RouteDiagramSection } from "@/components/result/RouteDiagramSection";
import { RouteDiagramSectionSkeleton } from "@/components/result/RouteDiagramSectionSkeleton";
import { ConfidenceSummarySection } from "@/components/result/ConfidenceSummarySection";
import { ConfidenceSummarySectionSkeleton } from "@/components/result/ConfidenceSummarySectionSkeleton";
import { WarningBadge } from "@/components/diagram/WarningBadge";

const VALID_MODES: RouteMode[] = ["fastest", "easy", "accessible"];

const DEFAULT_ACCESSIBILITY: AccessibilityCondition = {
  avoidStairs: false,
  preferElevator: false,
  preferEscalator: false,
};

interface ResultPageProps {
  searchParams: Promise<{
    originType?: string;
    originStationId?: string;
    destinationType?: string;
    destinationId?: string;
    mode?: string;
  }>;
}

export default async function RouteResultPage({ searchParams }: ResultPageProps) {
  const params = await searchParams;
  const user = await getSessionUser();

  const mode: RouteMode = VALID_MODES.includes(params.mode as RouteMode)
    ? (params.mode as RouteMode)
    : "easy";

  if (
    (params.originType !== "home_station" && !params.originStationId) ||
    !params.destinationType ||
    !params.destinationId
  ) {
    return <ErrorScreen user={user} message="検索条件が不足しています。" />;
  }

  // origin/destination の解決(stationId特定)は経路全体の解決より軽いため先にawaitする。
  // これが失敗する場合、経路自体を組み立てられずストリーミング表示のしようがない。
  const resolved = await resolveOriginDestination(
    {
      origin:
        params.originType === "home_station"
          ? { type: "home_station" }
          : { type: "station", stationId: params.originStationId! },
      destination:
        params.destinationType === "place"
          ? { type: "place", placeId: params.destinationId! }
          : { type: "station", stationId: params.destinationId! },
    },
    user,
    { stationProvider, placeProvider }
  );

  if (!resolved.ok) {
    return <ErrorScreen user={user} message={resolved.error} />;
  }

  const searchInput = {
    originStationId: resolved.originStationId,
    originLabel: resolved.originLabel,
    destinationStationId: resolved.destinationStationId,
    destinationLabel: resolved.destinationLabel,
    mode,
    accessibility: DEFAULT_ACCESSIBILITY,
  };

  // 経路候補自体(号車・改札・出口を除く骨格)が無ければ何も表示できないためawaitする。
  const candidate = await resolveRouteCandidate(searchInput, { routeProvider, stationProvider });

  if (!candidate.ok) {
    return <ErrorScreen user={user} message={candidate.reason} />;
  }

  if (user) {
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
  }

  // ここから先(号車・改札・出口情報)は Gemini 呼び出しを含み数秒〜数十秒かかりうるため、
  // await せず Promise のまま各セクションへ渡す。同じ Promise インスタンスを
  // 複数コンポーネントで共有しても JS の Promise キャッシュにより多重実行はされない。
  const trainSegmentsPromise = buildTrainSegments(candidate.chosen, { stationProvider });
  const facilitiesPromise = buildTransferAndExitSegments(candidate, searchInput, {
    stationProvider,
  });

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
        <KeyInstructionCard
          mode={mode}
          routeId={candidate.routeId}
          originName={candidate.originName}
          destinationName={candidate.destinationName}
          originStationId={resolved.originStationId}
          destinationStationId={resolved.destinationStationId}
          canSave={Boolean(user)}
          keyInstructionNode={
            <Suspense fallback={<KeyInstructionTextSkeleton />}>
              <KeyInstructionText
                trainSegmentsPromise={trainSegmentsPromise}
                facilitiesPromise={facilitiesPromise}
              />
            </Suspense>
          }
        />
        {candidate.routeWarnings.map((w, i) => (
          <WarningBadge key={i} text={w} />
        ))}

        <RouteSummaryCard
          originName={candidate.originName}
          destinationName={candidate.destinationName}
          arrivalStationName={candidate.arrivalStationName}
          recommendedExitNode={
            <Suspense fallback={<RecommendedExitValueSkeleton />}>
              <RecommendedExitValue facilitiesPromise={facilitiesPromise} />
            </Suspense>
          }
          estimatedDurationMinutes={candidate.estimatedDurationMinutes}
          transferCount={candidate.transferCount}
        />

        <section className="route-steps-container">
          <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">
            区間の詳細
          </h2>
          <div className="flex flex-col gap-3">
            <Suspense fallback={<TrainSegmentListSkeleton />}>
              <TrainSegmentList trainSegmentsPromise={trainSegmentsPromise} />
            </Suspense>
            <Suspense fallback={<TransferExitSegmentListSkeleton />}>
              <TransferExitSegmentList facilitiesPromise={facilitiesPromise} />
            </Suspense>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">
            簡易ルート図
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
      </main>
    </div>
  );
}

function ErrorScreen({ user, message }: { user: Awaited<ReturnType<typeof getSessionUser>>; message: string }) {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <p className="text-sm font-semibold text-[var(--foreground-muted)]">{message}</p>
        <Link
          href="/"
          className="rounded-[var(--radius-pill)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-foreground)]"
        >
          検索へ戻る
        </Link>
      </main>
    </div>
  );
}
