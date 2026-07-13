import { describe, expect, test } from "vitest";
import { candidateKey } from "../DestinationField";
import type { SearchCandidate } from "@/lib/services/place-resolution";
import type { Station, Destination } from "@/lib/domain/station";

const STATION: Station = {
  stationId: "st_shibuya",
  stationName: "渋谷駅",
  operator: "東急電鉄",
  lines: ["東急東横線"],
  prefecture: "東京都",
  latitude: 35.658,
  longitude: 139.7016,
};

const PLACE: Destination = {
  destinationId: "pl_hikarie",
  name: "渋谷ヒカリエ",
  category: "facility",
  address: "東京都渋谷区渋谷2-21-1",
  latitude: 35.6595,
  longitude: 139.7036,
  nearestStationCandidates: ["st_shibuya"],
};

describe("candidateKey", () => {
  test("station候補はkind+stationIdでキー化する", () => {
    const candidate: SearchCandidate = { kind: "station", station: STATION };
    expect(candidateKey(candidate)).toBe("station:st_shibuya");
  });

  test("place候補はkind+destinationIdでキー化する", () => {
    const candidate: SearchCandidate = { kind: "place", destination: PLACE };
    expect(candidateKey(candidate)).toBe("place:pl_hikarie");
  });

  test("駅と施設でstationId/destinationIdが同じ文字列でも衝突しない", () => {
    const stationCandidate: SearchCandidate = {
      kind: "station",
      station: { ...STATION, stationId: "shared_id" },
    };
    const placeCandidate: SearchCandidate = {
      kind: "place",
      destination: { ...PLACE, destinationId: "shared_id" },
    };
    expect(candidateKey(stationCandidate)).not.toBe(candidateKey(placeCandidate));
  });
});
