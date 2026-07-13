import { getSessionUser } from "@/lib/auth/session";
import { listFavoriteDestinations } from "@/lib/store/favorite-destination-repository";
import { sortFavoriteDestinationsByRecency } from "@/lib/services/favorite-destination-order";
import { AppHeader } from "@/components/layout/AppHeader";
import { FavoriteDestinationsView } from "@/components/favorites/FavoriteDestinationsView";

export default async function FavoriteDestinationsPage() {
  const user = await getSessionUser();
  const favorites = user
    ? sortFavoriteDestinationsByRecency(listFavoriteDestinations(user.userId))
    : [];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <h1 className="mb-4 text-lg font-black">よく使う行き先</h1>
        {!user ? (
          <p className="mb-3 text-xs text-[var(--foreground-muted)]">
            この端末にのみ保存されています。ログインするとどの端末からでも使えるようになります。
          </p>
        ) : null}
        <FavoriteDestinationsView user={user} initialFavorites={favorites} />
      </main>
    </div>
  );
}
