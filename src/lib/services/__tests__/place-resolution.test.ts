import { describe, expect, test } from "vitest";
import {
  candidateLabel,
  resolveArrivalStationId,
  type SearchCandidate,
} from "@/lib/services/place-resolution";
import type { Destination, Station } from "@/lib/domain/station";

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
