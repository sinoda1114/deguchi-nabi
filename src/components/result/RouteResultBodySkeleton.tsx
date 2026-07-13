import { ROUTE_MODE_LABEL, type RouteMode } from "@/lib/domain/route";
import { RouteOverviewContentSkeleton } from "@/components/result/RouteOverviewContentSkeleton";
import { RouteTimelineDiagramSectionSkeleton } from "@/components/result/RouteTimelineDiagramSectionSkeleton";
import { RouteDiagramSectionSkeleton } from "@/components/result/RouteDiagramSectionSkeleton";
import { ConfidenceSummarySectionSkeleton } from "@/components/result/ConfidenceSummarySectionSkeleton";

interface RouteResultBodySkeletonProps {
  mode: RouteMode;
}

/**
 * RouteResultBody の Suspense fallback。経路候補(candidate)自体の解決
 * (fixture未収録区間はAI生成を含み最大70秒)を待つ間、検索フォームから
 * 遷移した直後に白い画面のまま止まって見えないよう、結果画面のレイアウト
 * 骨格を即座に表示する。この時点で確定しているのは URL から分かる
 * mode のみで、経路名・所要時間・号車・出口はすべて未確定のためスケルトン。
 */
export function RouteResultBodySkeleton({ mode }: RouteResultBodySkeletonProps) {
  return (
    <>
      {/* main要素自体がaria-hidden="true"のため、視覚的なスケルトンとは別に
          スクリーンリーダー向けの状態通知をsr-onlyで用意する(旧loading.tsxの
          SearchingIndicatorが持っていたrole="status"を、結果画面の骨格を
          即時表示する形に変えた後も引き継ぐ)。 */}
      <p className="sr-only" role="status" aria-live="polite">
        ルートを検索しています
      </p>
      <main aria-hidden="true" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
        <div className="rounded-[var(--radius-card)] bg-[var(--accent)] p-5 text-[var(--accent-foreground)]">
          <div className="flex items-center justify-between">
            <span className="inline-block rounded-[var(--radius-pill)] bg-black/10 px-2.5 py-1 text-xs font-bold">
              {ROUTE_MODE_LABEL[mode]}モード
            </span>
          </div>
          <RouteOverviewContentSkeleton />
          <div className="skeleton-shimmer-on-accent mt-4 h-4 w-40 rounded-full" />
        </div>

        <section>
          <h2 className="mb-3 text-xs font-bold text-[var(--foreground-muted)]">ルートの流れ</h2>
          <RouteTimelineDiagramSectionSkeleton />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">ルート</h2>
          <RouteDiagramSectionSkeleton />
        </section>

        <ConfidenceSummarySectionSkeleton />
      </main>
    </>
  );
}
