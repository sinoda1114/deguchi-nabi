import type { FavoriteDestination, SearchHistoryEntry } from "@/lib/domain/user";

/**
 * 「最近の検索」履歴のうち、目的地の駅が既に「よく使う行き先」に登録済みのものを除外する。
 * よく使う行き先側で既に見えているものを履歴側で二重に見せないための軽量な重複排除。
 * 履歴側は駅IDしか持たないため、kind: "station" の favorite との一致判定のみ行う
 * (place種別のfavoriteとの突き合わせは対象外)。
 */
export function excludeHistoryDuplicatingFavoriteDestinations(
  history: readonly SearchHistoryEntry[],
  favorites: readonly FavoriteDestination[]
): SearchHistoryEntry[] {
  const favoriteStationIds = new Set(
    favorites.filter((f) => f.kind === "station").map((f) => f.station.stationId)
  );
  return history.filter((h) => !favoriteStationIds.has(h.query.destinationStationId));
}
