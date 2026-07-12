import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/layout/AppHeader";

interface ChatPageProps {
  searchParams: Promise<{ routeGuideId?: string }>;
}

/**
 * チャット補助(SCR-07)のプレースホルダ画面。
 * 02_SPECIFICATION.md §12 の応答ルール(表示中ルートの参照・断定しない等)を
 * 満たす実装は今回の MVP スコープ外。導線のみ用意する。
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  const { routeGuideId } = await searchParams;
  const user = await getSessionUser();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <p className="text-sm font-bold text-[var(--foreground)]">AIチャット補助は近日対応予定です</p>
        <p className="text-xs leading-relaxed text-[var(--foreground-muted)]">
          「階段を使いたくない」などの条件変更や、表示中のルートに関する質問に対応する予定です。
        </p>
        {routeGuideId ? (
          <Link
            href={`/feedback?routeGuideId=${routeGuideId}`}
            className="mt-2 text-sm font-bold text-[var(--accent)]"
          >
            この案内について報告する
          </Link>
        ) : null}
      </main>
    </div>
  );
}
