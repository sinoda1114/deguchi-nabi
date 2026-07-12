import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { stationProvider } from "@/lib/integrations";
import { listHistory } from "@/lib/store/history-repository";
import { listFavorites } from "@/lib/store/favorite-repository";
import { listFavoriteDestinations } from "@/lib/store/favorite-destination-repository";
import { AppHeader } from "@/components/layout/AppHeader";
import { SearchForm } from "@/components/search/SearchForm";

export default async function Home() {
  const user = await getSessionUser();
  const homeStation = user?.homeStationId
    ? await stationProvider.getStation(user.homeStationId)
    : null;

  const recentHistory = user ? listHistory(user.userId).slice(0, 3) : [];
  const favorites = user ? listFavorites(user.userId).slice(0, 3) : [];
  const favoriteDestinations = user ? listFavoriteDestinations(user.userId) : [];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <p className="mb-5 text-sm leading-relaxed text-[var(--foreground-muted)]">
          号車、乗換導線、改札、出口までを一続きで案内します。
        </p>

        <SearchForm user={user} homeStation={homeStation} favoriteDestinations={favoriteDestinations} />

        {user && favorites.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">お気に入り</h2>
            <ul className="flex flex-col gap-2">
              {favorites.map((f) => (
                <li key={f.favoriteId}>
                  <Link
                    href={`/routes/result?originType=station&originStationId=${f.query.originStationId}&destinationType=station&destinationId=${f.query.destinationStationId}&mode=${f.query.mode}`}
                    className="block rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold hover:border-[var(--accent)]"
                  >
                    {f.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {user && recentHistory.length > 0 ? (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">最近の検索</h2>
            <ul className="flex flex-col gap-2">
              {recentHistory.map((h) => (
                <li key={h.historyId}>
                  <Link
                    href={`/routes/result?originType=station&originStationId=${h.query.originStationId}&destinationType=station&destinationId=${h.query.destinationStationId}&mode=${h.query.mode}`}
                    className="block rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm hover:border-[var(--accent)]"
                  >
                    {h.originLabel} → {h.destinationLabel}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
