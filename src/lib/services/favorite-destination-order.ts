import type { FavoriteDestination } from "@/lib/domain/user";

/** よく使う行き先(FavoriteDestination)を登録が新しい順(createdAt降順)に並び替える。 */
export function sortFavoriteDestinationsByRecency(
  favorites: readonly FavoriteDestination[]
): FavoriteDestination[] {
  return [...favorites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
