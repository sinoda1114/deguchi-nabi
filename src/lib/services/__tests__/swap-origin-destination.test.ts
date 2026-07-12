import { describe, expect, test, vi } from "vitest";
import { swapOriginAndDestination } from "@/lib/services/swap-origin-destination";
import type { OriginChoice } from "@/components/search/OriginField";
import type { SearchCandidate } from "@/lib/services/place-resolution";
import type { Station } from "@/lib/domain/station";

const HOME_STATION: Station = {
  stationId: "st_shibuya",
  stationName: "渋谷駅",
  operator: "東急電鉄",
  lines: ["東急東横線"],
  prefecture: "東京都",
  latitude: 35.658,
  longitude: 139.7016,
};

const NISHIYA_STATION: Station = {
  stationId: "st_nishiya",
  stationName: "西谷駅",
  operator: "相鉄",
  lines: ["相鉄本線"],
  prefecture: "神奈川県",
  latitude: 35.482,
  longitude: 139.554,
};

const YOKOHAMA_STATION: Station = {
  stationId: "st_yokohama",
  stationName: "横浜駅",
  operator: "JR東日本",
  lines: ["東海道線"],
  prefecture: "神奈川県",
  latitude: 35.4657,
  longitude: 139.622,
};

describe("swapOriginAndDestination", () => {
  test("出発地がhome_station、目的地が駅の場合、home_stationのStationをそのまま目的地に、目的地の駅情報を出発地にする", async () => {
    const origin: OriginChoice = { type: "home_station", label: "渋谷駅" };
    const destination: SearchCandidate = { kind: "station", station: NISHIYA_STATION };
    const fetchStation = vi.fn();

    const result = await swapOriginAndDestination(origin, destination, HOME_STATION, fetchStation);

    expect(result).not.toBeNull();
    expect(result?.newOrigin).toEqual({
      type: "station",
      stationId: NISHIYA_STATION.stationId,
      label: NISHIYA_STATION.stationName,
    });
    expect(result?.newDestination).toEqual({ kind: "station", station: HOME_STATION });
    // 駅の完全情報はどちらもpropsだけで揃うため、追加APIフェッチは不要
    expect(fetchStation).not.toHaveBeenCalled();
  });

  test("出発地がstation(手入力等)、目的地が駅の場合、出発地のstationIdからStationを取得して目的地にする", async () => {
    const origin: OriginChoice = {
      type: "station",
      stationId: NISHIYA_STATION.stationId,
      label: NISHIYA_STATION.stationName,
    };
    const destination: SearchCandidate = { kind: "station", station: YOKOHAMA_STATION };
    const fetchStation = vi.fn(async (stationId: string) =>
      stationId === NISHIYA_STATION.stationId ? NISHIYA_STATION : null
    );

    const result = await swapOriginAndDestination(origin, destination, null, fetchStation);

    expect(result).not.toBeNull();
    expect(result?.newOrigin).toEqual({
      type: "station",
      stationId: YOKOHAMA_STATION.stationId,
      label: YOKOHAMA_STATION.stationName,
    });
    expect(result?.newDestination).toEqual({ kind: "station", station: NISHIYA_STATION });
    expect(fetchStation).toHaveBeenCalledWith(NISHIYA_STATION.stationId);
  });

  test("目的地が施設(place)の場合、最寄り駅候補の先頭からStationを取得して出発地にする", async () => {
    const origin: OriginChoice = { type: "home_station", label: "渋谷駅" };
    const destination: SearchCandidate = {
      kind: "place",
      destination: {
        destinationId: "dest_1",
        name: "ランドマークタワー",
        category: "facility",
        address: "横浜市西区みなとみらい",
        latitude: 35.454,
        longitude: 139.631,
        nearestStationCandidates: [YOKOHAMA_STATION.stationId, "st_other"],
      },
    };
    const fetchStation = vi.fn(async (stationId: string) =>
      stationId === YOKOHAMA_STATION.stationId ? YOKOHAMA_STATION : null
    );

    const result = await swapOriginAndDestination(origin, destination, HOME_STATION, fetchStation);

    expect(result).not.toBeNull();
    expect(result?.newOrigin).toEqual({
      type: "station",
      stationId: YOKOHAMA_STATION.stationId,
      label: YOKOHAMA_STATION.stationName,
    });
    expect(result?.newDestination).toEqual({ kind: "station", station: HOME_STATION });
    expect(fetchStation).toHaveBeenCalledWith(YOKOHAMA_STATION.stationId);
  });

  test("目的地の施設にnearestStationCandidatesが無い場合はnullを返す(入れ替え不可)", async () => {
    const origin: OriginChoice = { type: "home_station", label: "渋谷駅" };
    const destination: SearchCandidate = {
      kind: "place",
      destination: {
        destinationId: "dest_2",
        name: "何もない場所",
        category: "address",
        address: "どこか",
        latitude: 0,
        longitude: 0,
        nearestStationCandidates: [],
      },
    };
    const fetchStation = vi.fn();

    const result = await swapOriginAndDestination(origin, destination, HOME_STATION, fetchStation);

    expect(result).toBeNull();
    expect(fetchStation).not.toHaveBeenCalled();
  });

  test("stationのAPIフェッチが失敗(null)した場合はnullを返す(入れ替え不可)", async () => {
    const origin: OriginChoice = {
      type: "station",
      stationId: "st_unknown",
      label: "不明な駅",
    };
    const destination: SearchCandidate = { kind: "station", station: YOKOHAMA_STATION };
    const fetchStation = vi.fn(async () => null);

    const result = await swapOriginAndDestination(origin, destination, null, fetchStation);

    expect(result).toBeNull();
  });

  test("home_stationだがhomeStationがnull(取得失敗等)の場合はnullを返す(入れ替え不可)", async () => {
    const origin: OriginChoice = { type: "home_station", label: "渋谷駅" };
    const destination: SearchCandidate = { kind: "station", station: YOKOHAMA_STATION };
    const fetchStation = vi.fn();

    const result = await swapOriginAndDestination(origin, destination, null, fetchStation);

    expect(result).toBeNull();
    expect(fetchStation).not.toHaveBeenCalled();
  });
});
