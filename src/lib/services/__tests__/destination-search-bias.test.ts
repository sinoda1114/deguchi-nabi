import { describe, expect, test } from "vitest";
import { destinationSearchBiasCoordinates } from "../destination-search-bias";
import type { OriginChoice } from "@/components/search/origin-choice";
import type { Station } from "@/lib/domain/station";

const NISHIYA: Station = {
  stationId: "st_nishiya",
  stationName: "西谷駅",
  operator: "相模鉄道",
  lines: ["相鉄本線"],
  prefecture: "神奈川県",
  latitude: 35.4696,
  longitude: 139.5679,
};

const NAGOYA: Station = {
  stationId: "st_nagoya",
  stationName: "名古屋駅",
  operator: "東海旅客鉄道",
  lines: ["東海道新幹線"],
  prefecture: "愛知県",
  latitude: 35.170915,
  longitude: 136.881537,
};

describe("destinationSearchBiasCoordinates", () => {
  test("出発地未選択ならバイアス無し", () => {
    expect(
      destinationSearchBiasCoordinates(null, { homeStation: NISHIYA, localDefaultStation: NAGOYA })
    ).toBeNull();
  });

  test("home_station なら登録駅の座標を使う", () => {
    const origin: OriginChoice = { type: "home_station", label: "西谷駅" };
    expect(
      destinationSearchBiasCoordinates(origin, { homeStation: NISHIYA, localDefaultStation: null })
    ).toEqual({ lat: NISHIYA.latitude, lng: NISHIYA.longitude });
  });

  test("home_station でも登録駅が無ければバイアス無し", () => {
    const origin: OriginChoice = { type: "home_station", label: "西谷駅" };
    expect(
      destinationSearchBiasCoordinates(origin, { homeStation: null, localDefaultStation: NISHIYA })
    ).toBeNull();
  });

  test("選択中の駅に座標があれば登録駅よりそちらを優先する", () => {
    const origin: OriginChoice = {
      type: "station",
      stationId: NAGOYA.stationId,
      label: NAGOYA.stationName,
      latitude: NAGOYA.latitude,
      longitude: NAGOYA.longitude,
    };
    expect(
      destinationSearchBiasCoordinates(origin, { homeStation: NISHIYA, localDefaultStation: null })
    ).toEqual({ lat: NAGOYA.latitude, lng: NAGOYA.longitude });
  });

  test("下書きの駅選択に座標が無くても、登録駅またはデフォルト駅と ID が一致すればその座標を使う", () => {
    const origin: OriginChoice = {
      type: "station",
      stationId: NISHIYA.stationId,
      label: NISHIYA.stationName,
    };
    expect(
      destinationSearchBiasCoordinates(origin, { homeStation: NISHIYA, localDefaultStation: null })
    ).toEqual({ lat: NISHIYA.latitude, lng: NISHIYA.longitude });
    expect(
      destinationSearchBiasCoordinates(origin, { homeStation: null, localDefaultStation: NISHIYA })
    ).toEqual({ lat: NISHIYA.latitude, lng: NISHIYA.longitude });
  });

  test("座標も既知駅も無い駅選択はバイアス無し", () => {
    const origin: OriginChoice = {
      type: "station",
      stationId: NAGOYA.stationId,
      label: NAGOYA.stationName,
    };
    expect(
      destinationSearchBiasCoordinates(origin, { homeStation: NISHIYA, localDefaultStation: null })
    ).toBeNull();
  });
});
