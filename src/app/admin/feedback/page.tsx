import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isAdminUser } from "@/lib/auth/admin";
import { listFeedback } from "@/lib/store/feedback-repository";
import { FEEDBACK_CATEGORY_LABEL } from "@/lib/domain/feedback";
import { AppHeader } from "@/components/layout/AppHeader";
import { FeedbackStatusSelector } from "@/components/admin/FeedbackStatusSelector";

export default async function AdminFeedbackPage() {
  const user = await getSessionUser();
  if (!isAdminUser(user)) redirect("/");

  const feedback = listFeedback().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <h1 className="mb-1 text-lg font-black">フィードバック管理</h1>
        <p className="mb-6 text-sm text-[var(--foreground-muted)]">
          利用者からの誤情報報告を確認し、ステータスを更新します。
        </p>

        {feedback.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">報告はまだありません。</p>
        ) : (
          <div className="flex flex-col gap-3">
            {feedback.map((f) => (
              <div
                key={f.feedbackId}
                className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--accent)]">
                    {FEEDBACK_CATEGORY_LABEL[f.category]}
                  </span>
                  <FeedbackStatusSelector feedbackId={f.feedbackId} status={f.status} />
                </div>
                <p className="text-sm font-semibold">{f.targetEntity}</p>
                {f.reportedValue ? (
                  <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                    現在の表示: {f.reportedValue}
                  </p>
                ) : null}
                {f.suggestedValue ? (
                  <p className="text-xs text-[var(--foreground-muted)]">
                    正しいと思う情報: {f.suggestedValue}
                  </p>
                ) : null}
                {f.comment ? (
                  <p className="mt-2 text-xs text-[var(--foreground)]">{f.comment}</p>
                ) : null}
                <p className="mt-2 text-[11px] text-[var(--foreground-muted)]">
                  ルートID: {f.routeGuideId} ・ {new Date(f.createdAt).toLocaleString("ja-JP")}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
