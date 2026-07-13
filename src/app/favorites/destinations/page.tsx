import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { listFavoriteDestinations } from "@/lib/store/favorite-destination-repository";
import { sortFavoriteDestinationsByRecency } from "@/lib/services/favorite-destination-order";
import { AppHeader } from "@/components/layout/AppHeader";
import { RemoveButton } from "@/components/favorites/RemoveButton";

export default async function FavoriteDestinationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const favorites = sortFavoriteDestinationsByRecency(listFavoriteDestinations(user.userId));

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <h1 className="mb-4 text-lg font-black">よく使う行き先</h1>

        {favorites.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            まだよく使う行き先が登録されていません。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {favorites.map((f) => (
              <li
                key={f.favoriteDestinationId}
                className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              >
                <span className="flex-1 text-sm font-semibold">{f.label}</span>
                <RemoveButton endpoint={`/api/favorite-destinations/${f.favoriteDestinationId}`} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
