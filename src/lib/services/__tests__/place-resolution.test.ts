import { describe, expect, test } from "vitest";
import {
  candidateLabel,
  isSameFavoriteTarget,
  resolveArrivalStationId,
  toFavoriteDestinationInput,
  toSearchCandidate,
  type SearchCandidate,
} from "@/lib/services/place-resolution";
import type { Destination, Station } from "@/lib/domain/station";
import type { FavoriteDestination } from "@/lib/domain/user";

const STATION: Station = {
  stationId: "st_1",
  stationName: "テスト駅",
  operator: "テスト鉄道",
  lines: ["テスト線"],
  prefecture: "東京都",
  latitude: 0,
  longitude: 0,
};

const DESTINATION: Destination = {
  destinationId: "dest_1",
  name: "テスト施設",
  category: "facility",
  address: "東京都テスト区1-1-1",
  latitude: 0,
  longitude: 0,
  nearestStationCandidates: ["st_1", "st_2"],
};

describe("resolveArrivalStationId", () => {
  test("station candidate はそのまま stationId を返す", () => {
    const candidate: SearchCandidate = { kind: "station", station: STATION };
    expect(resolveArrivalStationId(candidate)).toBe("st_1");
  });

  test("place candidate は最寄り駅候補の先頭を返す", () => {
    const candidate: SearchCandidate = { kind: "place", destination: DESTINATION };
    expect(resolveArrivalStationId(candidate)).toBe("st_1");
  });

  test("最寄り駅候補が無い place candidate は null を返す", () => {
    const candidate: SearchCandidate = {
      kind: "place",
      destination: { ...DESTINATION, nearestStationCandidates: [] },
    };
    expect(resolveArrivalStationId(candidate)).toBeNull();
  });
});

describe("candidateLabel", () => {
  test("station candidate は駅名を返す", () => {
    expect(candidateLabel({ kind: "station", station: STATION })).toBe("テスト駅");
  });

  test("place candidate は施設名を返す", () => {
    expect(candidateLabel({ kind: "place", destination: DESTINATION })).toBe("テスト施設");
  });
});

describe("toFavoriteDestinationInput", () => {
  test("station candidate から kind/station/label を持つ入力を作る", () => {
    const candidate: SearchCandidate = { kind: "station", station: STATION };
    expect(toFavoriteDestinationInput(candidate)).toEqual({
      kind: "station",
      station: STATION,
      label: "テスト駅",
    });
  });

  test("place candidate から kind/destination/label を持つ入力を作る", () => {
    const candidate: SearchCandidate = { kind: "place", destination: DESTINATION };
    expect(toFavoriteDestinationInput(candidate)).toEqual({
      kind: "place",
      destination: DESTINATION,
      label: "テスト施設",
    });
  });
});

describe("toSearchCandidate", () => {
  test("station の FavoriteDestination は station candidate に変換される", () => {
    const favorite: FavoriteDestination = {
      favoriteDestinationId: "fd_1",
      userId: "user_1",
      kind: "station",
      station: STATION,
      label: "テスト駅",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(toSearchCandidate(favorite)).toEqual({ kind: "station", station: STATION });
  });

  test("place の FavoriteDestination は place candidate に変換される", () => {
    const favorite: FavoriteDestination = {
      favoriteDestinationId: "fd_2",
      userId: "user_1",
      kind: "place",
      destination: DESTINATION,
      label: "テスト施設",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(toSearchCandidate(favorite)).toEqual({ kind: "place", destination: DESTINATION });
  });
});

describe("isSameFavoriteTarget", () => {
  const stationFavorite: FavoriteDestination = {
    favoriteDestinationId: "fd_1",
    userId: "user_1",
    kind: "station",
    station: STATION,
    label: "テスト駅",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const placeFavorite: FavoriteDestination = {
    favoriteDestinationId: "fd_2",
    userId: "user_1",
    kind: "place",
    destination: DESTINATION,
    label: "テスト施設",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  test("同じ駅IDの station candidate は一致する", () => {
    expect(isSameFavoriteTarget(stationFavorite, { kind: "station", station: STATION })).toBe(
      true
    );
  });

  test("異なる駅IDの station candidate は一致しない", () => {
    const other: Station = { ...STATION, stationId: "st_2" };
    expect(isSameFavoriteTarget(stationFavorite, { kind: "station", station: other })).toBe(
      false
    );
  });

  test("同じ施設IDの place candidate は一致する", () => {
    expect(
      isSameFavoriteTarget(placeFavorite, { kind: "place", destination: DESTINATION })
    ).toBe(true);
  });

  test("kind が異なると一致しない", () => {
    expect(isSameFavoriteTarget(stationFavorite, { kind: "place", destination: DESTINATION })).toBe(
      false
    );
  });
});
