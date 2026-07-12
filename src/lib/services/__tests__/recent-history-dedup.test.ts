import { describe, expect, test } from "vitest";
import { excludeHistoryDuplicatingFavoriteDestinations } from "@/lib/services/recent-history-dedup";
import type { FavoriteDestination, SearchHistoryEntry } from "@/lib/domain/user";
import type { Destination, Station } from "@/lib/domain/station";

function station(id: string): Station {
  return {
    stationId: id,
    stationName: `駅${id}`,
    operator: "テスト鉄道",
    lines: ["テスト線"],
    prefecture: "東京都",
    latitude: 0,
    longitude: 0,
  };
}

function destination(id: string): Destination {
  return {
    destinationId: id,
    name: `施設${id}`,
    category: "facility",
    address: "東京都テスト区1-1-1",
    latitude: 0,
    longitude: 0,
    nearestStationCandidates: [],
  };
}

function historyEntry(id: string, destinationStationId: string): SearchHistoryEntry {
  return {
    historyId: id,
    userId: "user_1",
    routeGuideId: `route_${id}`,
    originLabel: "出発駅",
    destinationLabel: "到着駅",
    mode: "easy",
    query: { originStationId: "st_origin", destinationStationId, mode: "easy" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function stationFavorite(stationId: string): FavoriteDestination {
  return {
    favoriteDestinationId: `fav_${stationId}`,
    userId: "user_1",
    kind: "station",
    station: station(stationId),
    label: `駅${stationId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function placeFavorite(destinationId: string): FavoriteDestination {
  return {
    favoriteDestinationId: `fav_${destinationId}`,
    userId: "user_1",
    kind: "place",
    destination: destination(destinationId),
    label: `施設${destinationId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("excludeHistoryDuplicatingFavoriteDestinations", () => {
  test("目的地駅がお気に入り登録済みの履歴は除外する", () => {
    const history = [historyEntry("h1", "st_a"), historyEntry("h2", "st_b")];
    const favorites = [stationFavorite("st_a")];

    const result = excludeHistoryDuplicatingFavoriteDestinations(history, favorites);

    expect(result.map((h) => h.historyId)).toEqual(["h2"]);
  });

  test("お気に入りに一致しない履歴はそのまま残す", () => {
    const history = [historyEntry("h1", "st_a")];
    const favorites = [stationFavorite("st_z")];

    const result = excludeHistoryDuplicatingFavoriteDestinations(history, favorites);

    expect(result.map((h) => h.historyId)).toEqual(["h1"]);
  });

  test("place種別のお気に入りは駅IDと突き合わせない(対象外)", () => {
    const history = [historyEntry("h1", "st_a")];
    const favorites = [placeFavorite("st_a")];

    const result = excludeHistoryDuplicatingFavoriteDestinations(history, favorites);

    expect(result.map((h) => h.historyId)).toEqual(["h1"]);
  });

  test("お気に入りが空なら履歴は変化しない", () => {
    const history = [historyEntry("h1", "st_a"), historyEntry("h2", "st_b")];

    const result = excludeHistoryDuplicatingFavoriteDestinations(history, []);

    expect(result.map((h) => h.historyId)).toEqual(["h1", "h2"]);
  });

  test("元の配列を破壊しない", () => {
    const history = [historyEntry("h1", "st_a")];
    const favorites = [stationFavorite("st_a")];

    excludeHistoryDuplicatingFavoriteDestinations(history, favorites);

    expect(history).toHaveLength(1);
  });
});
