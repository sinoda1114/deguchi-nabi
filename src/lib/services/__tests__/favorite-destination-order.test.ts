import { describe, expect, test } from "vitest";
import { sortFavoriteDestinationsByRecency } from "@/lib/services/favorite-destination-order";
import type { FavoriteDestination } from "@/lib/domain/user";
import type { Station } from "@/lib/domain/station";

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

function favorite(id: string, createdAt: string): FavoriteDestination {
  return {
    favoriteDestinationId: id,
    userId: "user_1",
    kind: "station",
    station: station(id),
    label: `駅${id}`,
    createdAt,
  };
}

describe("sortFavoriteDestinationsByRecency", () => {
  test("createdAt の新しい順に並び替える", () => {
    const favorites = [
      favorite("a", "2026-01-01T00:00:00.000Z"),
      favorite("b", "2026-03-01T00:00:00.000Z"),
      favorite("c", "2026-02-01T00:00:00.000Z"),
    ];

    const sorted = sortFavoriteDestinationsByRecency(favorites);

    expect(sorted.map((f) => f.favoriteDestinationId)).toEqual(["b", "c", "a"]);
  });

  test("元の配列を破壊しない", () => {
    const favorites = [
      favorite("a", "2026-01-01T00:00:00.000Z"),
      favorite("b", "2026-03-01T00:00:00.000Z"),
    ];

    sortFavoriteDestinationsByRecency(favorites);

    expect(favorites.map((f) => f.favoriteDestinationId)).toEqual(["a", "b"]);
  });

  test("空配列を渡すと空配列を返す", () => {
    expect(sortFavoriteDestinationsByRecency([])).toEqual([]);
  });
});
