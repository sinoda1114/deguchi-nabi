import { randomUUID } from "node:crypto";
import type { FavoriteRoute, SavedRouteQuery } from "@/lib/domain/user";
import { readCollection, writeCollection } from "./json-file-store";

const COLLECTION = "favorites";

export function listFavorites(userId: string): FavoriteRoute[] {
  return readCollection<FavoriteRoute>(COLLECTION).filter(
    (f) => f.userId === userId
  );
}

export function addFavorite(
  userId: string,
  routeGuideId: string,
  label: string,
  query: SavedRouteQuery
): FavoriteRoute {
  const favorites = readCollection<FavoriteRoute>(COLLECTION);
  const favorite: FavoriteRoute = {
    favoriteId: randomUUID(),
    userId,
    routeGuideId,
    label,
    query,
    createdAt: new Date().toISOString(),
  };
  writeCollection(COLLECTION, [...favorites, favorite]);
  return favorite;
}

export function removeFavorite(userId: string, favoriteId: string): void {
  const favorites = readCollection<FavoriteRoute>(COLLECTION);
  writeCollection(
    COLLECTION,
    favorites.filter((f) => !(f.userId === userId && f.favoriteId === favoriteId))
  );
}
