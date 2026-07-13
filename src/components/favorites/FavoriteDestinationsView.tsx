"use client";

import { useEffect, useState } from "react";
import { RemoveButton } from "./RemoveButton";
import {
  listLocalFavoriteDestinations,
  removeLocalFavoriteDestination,
} from "@/lib/services/local-favorite-destinations";
import type { FavoriteDestination, User } from "@/lib/domain/user";

interface FavoriteDestinationsViewProps {
  user: User | null;
  /** ログイン中はサーバーの一覧、未ログイン中は常に空(クライアント側でlocalStorageから補う)。 */
  initialFavorites: FavoriteDestination[];
}

export function FavoriteDestinationsView({ user, initialFavorites }: FavoriteDestinationsViewProps) {
  const [favorites, setFavorites] = useState(initialFavorites);

  // ログイン中はサーバー確定値(initialFavorites)に追従させる(RemoveButtonのrouter.refresh()
  // 後の再取得にも対応するため)。未ログイン中は、SSRでは取得できないlocalStorage(外部
  // システム)の内容をここで取り込む。レンダー中に直接読むとhydration mismatchになるため
  // useEffectで行う。
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- サーバー確定値への追従
      setFavorites(initialFavorites);
      return;
    }
    setFavorites(listLocalFavoriteDestinations());
  }, [user, initialFavorites]);

  function handleLocalRemove(favoriteDestinationId: string) {
    removeLocalFavoriteDestination(favoriteDestinationId);
    setFavorites((prev) => prev.filter((f) => f.favoriteDestinationId !== favoriteDestinationId));
  }

  if (favorites.length === 0) {
    return (
      <p className="text-sm text-[var(--foreground-muted)]">
        まだよく使う行き先が登録されていません。
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {favorites.map((f) => (
        <li
          key={f.favoriteDestinationId}
          className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
        >
          <span className="flex-1 text-sm font-semibold">{f.label}</span>
          {user ? (
            <RemoveButton endpoint={`/api/favorite-destinations/${f.favoriteDestinationId}`} />
          ) : (
            <RemoveButton onRemove={() => handleLocalRemove(f.favoriteDestinationId)} />
          )}
        </li>
      ))}
    </ul>
  );
}
