import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { listFavorites } from "@/lib/store/favorite-repository";
import { AppHeader } from "@/components/layout/AppHeader";
import { RemoveButton } from "@/components/favorites/RemoveButton";

export default async function FavoritesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const favorites = listFavorites(user.userId);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <h1 className="mb-4 text-lg font-black">保存したルート</h1>

        {favorites.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            まだ保存されたルートはありません。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {favorites.map((f) => (
              <li
                key={f.favoriteId}
                className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              >
                <Link
                  href={`/routes/result?originType=station&originStationId=${f.query.originStationId}&destinationType=station&destinationId=${f.query.destinationStationId}&mode=${f.query.mode}`}
                  className="flex-1 text-sm font-semibold"
                >
                  {f.label}
                </Link>
                <RemoveButton endpoint={`/api/favorites/${f.favoriteId}`} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
