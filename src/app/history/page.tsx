import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { listHistory } from "@/lib/store/history-repository";
import { AppHeader } from "@/components/layout/AppHeader";
import { RemoveButton } from "@/components/favorites/RemoveButton";

export default async function HistoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const history = listHistory(user.userId);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <h1 className="mb-4 text-lg font-black">検索履歴</h1>

        {history.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">検索履歴はまだありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li
                key={h.historyId}
                className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              >
                <Link
                  href={`/routes/result?originType=station&originStationId=${h.query.originStationId}&destinationType=station&destinationId=${h.query.destinationStationId}&mode=${h.query.mode}`}
                  className="flex-1 text-sm"
                >
                  <span className="font-semibold">
                    {h.originLabel} → {h.destinationLabel}
                  </span>
                  <span className="ml-2 text-xs text-[var(--foreground-muted)]">
                    {new Date(h.createdAt).toLocaleString("ja-JP")}
                  </span>
                </Link>
                <RemoveButton endpoint={`/api/history/${h.historyId}`} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
