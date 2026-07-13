// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  clearLocalDefaultOriginStation,
  getLocalDefaultOriginStation,
  setLocalDefaultOriginStation,
} from "../local-default-origin-station";
import type { Station } from "@/lib/domain/station";

const STATION: Station = {
  stationId: "st_1",
  stationName: "テスト駅",
  operator: "テスト鉄道",
  lines: ["テスト線"],
  prefecture: "東京都",
  latitude: 0,
  longitude: 0,
};

const OTHER_STATION: Station = { ...STATION, stationId: "st_2", stationName: "別のテスト駅" };

describe("local-default-origin-station", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  test("未設定なら null を返す", () => {
    expect(getLocalDefaultOriginStation()).toBeNull();
  });

  test("設定した駅が取得できる", () => {
    setLocalDefaultOriginStation(STATION);
    expect(getLocalDefaultOriginStation()).toEqual(STATION);
  });

  test("再設定すると上書きされる(単一スロット)", () => {
    setLocalDefaultOriginStation(STATION);
    setLocalDefaultOriginStation(OTHER_STATION);
    expect(getLocalDefaultOriginStation()).toEqual(OTHER_STATION);
  });

  test("clearLocalDefaultOriginStation で消える", () => {
    setLocalDefaultOriginStation(STATION);
    clearLocalDefaultOriginStation();
    expect(getLocalDefaultOriginStation()).toBeNull();
  });

  test("壊れたJSONが保存されていても例外を投げずnullを返す", () => {
    window.localStorage.setItem("deguchi-nabi:local-default-origin-station", "{not valid json");
    expect(getLocalDefaultOriginStation()).toBeNull();
  });

  test("パースは通るが形の不正なデータ(手動編集等)はnull扱いにする", () => {
    window.localStorage.setItem(
      "deguchi-nabi:local-default-origin-station",
      JSON.stringify({ stationId: "st_1" }) // stationName等が欠落
    );
    expect(getLocalDefaultOriginStation()).toBeNull();
  });
});
