import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/layout/AppHeader";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";

interface FeedbackPageProps {
  searchParams: Promise<{ routeGuideId?: string }>;
}

export default async function FeedbackPage({ searchParams }: FeedbackPageProps) {
  const { routeGuideId } = await searchParams;
  const user = await getSessionUser();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <h1 className="mb-1 text-lg font-black">情報の誤りを報告</h1>
        <p className="mb-5 text-sm text-[var(--foreground-muted)]">
          号車・改札・出口などの案内が実際と異なる場合、教えてください。
        </p>

        {!user ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
            フィードバックの送信にはログインが必要です。
            <Link href="/login" className="ml-1 font-bold text-[var(--accent)]">
              ログイン
            </Link>
          </div>
        ) : !routeGuideId ? (
          <p className="text-sm text-[var(--foreground-muted)]">対象のルートが指定されていません。</p>
        ) : (
          <FeedbackForm routeGuideId={routeGuideId} />
        )}
      </main>
    </div>
  );
}
