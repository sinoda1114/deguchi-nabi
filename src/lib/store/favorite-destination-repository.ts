import { randomUUID } from "node:crypto";
import type { FavoriteDestination } from "@/lib/domain/user";
import type { FavoriteDestinationInput } from "@/lib/services/place-resolution";
import { readCollection, writeCollection } from "./json-file-store";

const COLLECTION = "favorite-destinations";
// ホーム画面の検索フォームに全件ボタン表示するため、際限なく増えると
// レスポンス・描画コストが膨らむ。ユーザーあたりの上限を設けて防ぐ。
const MAX_FAVORITES_PER_USER = 20;

function isSameTarget(existing: FavoriteDestination, input: FavoriteDestinationInput): boolean {
  if (existing.kind === "station" && input.kind === "station") {
    return existing.station.stationId === input.station.stationId;
  }
  if (existing.kind === "place" && input.kind === "place") {
    return existing.destination.destinationId === input.destination.destinationId;
  }
  return false;
}

export function listFavoriteDestinations(userId: string): FavoriteDestination[] {
  return readCollection<FavoriteDestination>(COLLECTION).filter((f) => f.userId === userId);
}

export type AddFavoriteDestinationResult =
  | { ok: true; favoriteDestination: FavoriteDestination }
  | { ok: false; reason: "limit_exceeded" };

/**
 * 同じ駅・施設が既に登録済みなら新規追加せず既存レコードを返す(重複登録防止)。
 * ユーザーあたりの登録上限(MAX_FAVORITES_PER_USER)に達している場合は失敗を返す。
 */
export function addFavoriteDestination(
  userId: string,
  input: FavoriteDestinationInput
): AddFavoriteDestinationResult {
  const favorites = readCollection<FavoriteDestination>(COLLECTION);
  const userFavorites = favorites.filter((f) => f.userId === userId);

  const existing = userFavorites.find((f) => isSameTarget(f, input));
  if (existing) return { ok: true, favoriteDestination: existing };

  if (userFavorites.length >= MAX_FAVORITES_PER_USER) {
    return { ok: false, reason: "limit_exceeded" };
  }

  const base = {
    favoriteDestinationId: randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
  };
  const favorite: FavoriteDestination =
    input.kind === "station"
      ? { ...base, kind: "station", station: input.station, label: input.label }
      : { ...base, kind: "place", destination: input.destination, label: input.label };

  writeCollection(COLLECTION, [...favorites, favorite]);
  return { ok: true, favoriteDestination: favorite };
}

export function removeFavoriteDestination(userId: string, favoriteDestinationId: string): void {
  const favorites = readCollection<FavoriteDestination>(COLLECTION);
  writeCollection(
    COLLECTION,
    favorites.filter(
      (f) => !(f.userId === userId && f.favoriteDestinationId === favoriteDestinationId)
    )
  );
}
