import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { resolveAndSearchRoute } from "@/lib/services/route-search-orchestrator";
import { addHistoryEntry } from "@/lib/store/history-repository";
import type { RouteMode } from "@/lib/domain/route";
import { AppHeader } from "@/components/layout/AppHeader";
import { KeyInstructionCard } from "@/components/result/KeyInstructionCard";
import { RouteSummaryCard } from "@/components/result/RouteSummaryCard";
import { RouteDiagram } from "@/components/diagram/RouteDiagram";
import { RouteTimeline } from "@/components/timeline/RouteTimeline";
import { ConfidenceSummary } from "@/components/result/ConfidenceSummary";
import { WarningBadge } from "@/components/diagram/WarningBadge";

const VALID_MODES: RouteMode[] = ["fastest", "easy", "accessible"];

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

  const result = await resolveAndSearchRoute(
    {
      origin:
        params.originType === "home_station"
          ? { type: "home_station" }
          : { type: "station", stationId: params.originStationId! },
      destination:
        params.destinationType === "place"
          ? { type: "place", placeId: params.destinationId! }
          : { type: "station", stationId: params.destinationId! },
      mode,
    },
    user
  );

  if (!result.ok) {
    return <ErrorScreen user={user} message={result.error} />;
  }

  if (user) {
    addHistoryEntry({
      userId: user.userId,
      routeGuideId: result.route.routeId,
      originLabel: result.originLabel,
      destinationLabel: result.destinationLabel,
      mode,
      query: {
        originStationId: result.originStationId,
        destinationStationId: result.destinationStationId,
        mode,
      },
    });
  }

  const { route } = result;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
        <KeyInstructionCard
          route={route}
          originStationId={result.originStationId}
          destinationStationId={result.destinationStationId}
          canSave={Boolean(user)}
        />
        {route.warnings.map((w, i) => (
          <WarningBadge key={i} text={w} />
        ))}

        <RouteSummaryCard route={route} />

        <section>
          <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">
            区間の詳細
          </h2>
          <RouteTimeline segments={route.segments} />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">
            簡易ルート図
          </h2>
          <RouteDiagram segments={route.segments} />
        </section>

        <ConfidenceSummary summary={route.confidenceSummary} />

        <Link
          href={`/chat?routeGuideId=${route.routeId}`}
          className="rounded-[var(--radius-card)] bg-[var(--accent)] py-3 text-center text-sm font-bold text-[var(--accent-foreground)] hover:opacity-90"
        >
          この案内について質問する
        </Link>

        <Link
          href={`/feedback?routeGuideId=${route.routeId}`}
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
