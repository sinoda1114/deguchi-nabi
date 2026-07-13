// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  addLocalFavoriteDestination,
  clearLocalFavoriteDestinations,
  listLocalFavoriteDestinations,
  LOCAL_USER_ID,
  removeLocalFavoriteDestination,
} from "../local-favorite-destinations";
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

const OTHER_STATION: Station = { ...STATION, stationId: "st_2", stationName: "別のテスト駅" };

const DESTINATION: Destination = {
  destinationId: "dest_1",
  name: "テスト施設",
  category: "facility",
  address: "東京都テスト区1-1-1",
  latitude: 0,
  longitude: 0,
  nearestStationCandidates: ["st_1"],
};

function addOk(input: Parameters<typeof addLocalFavoriteDestination>[0]) {
  const result = addLocalFavoriteDestination(input);
  if (!result.ok) throw new Error("expected ok:true");
  return result.favoriteDestination;
}

describe("local-favorite-destinations", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  test("addLocalFavoriteDestination で登録した目的地が listLocalFavoriteDestinations で取得できる", () => {
    const created = addOk({ kind: "station", station: STATION, label: "テスト駅" });

    expect(created.favoriteDestinationId).toBeTruthy();
    expect(created.userId).toBe(LOCAL_USER_ID);
    expect(created.createdAt).toBeTruthy();
    expect(listLocalFavoriteDestinations()).toEqual([created]);
  });

  test("place の目的地も登録・取得できる", () => {
    const created = addOk({ kind: "place", destination: DESTINATION, label: "テスト施設" });
    expect(listLocalFavoriteDestinations()).toEqual([created]);
  });

  test("同じ駅を重複登録しても増えず、既存のレコードを返す", () => {
    const first = addOk({ kind: "station", station: STATION, label: "テスト駅" });
    const second = addOk({ kind: "station", station: STATION, label: "テスト駅" });

    expect(second.favoriteDestinationId).toBe(first.favoriteDestinationId);
    expect(listLocalFavoriteDestinations()).toHaveLength(1);
  });

  test("異なる駅は別レコードとして登録される", () => {
    addOk({ kind: "station", station: STATION, label: "テスト駅" });
    addOk({ kind: "station", station: OTHER_STATION, label: "別のテスト駅" });

    expect(listLocalFavoriteDestinations()).toHaveLength(2);
  });

  test("removeLocalFavoriteDestination で削除できる", () => {
    const created = addOk({ kind: "station", station: STATION, label: "テスト駅" });

    removeLocalFavoriteDestination(created.favoriteDestinationId);

    expect(listLocalFavoriteDestinations()).toHaveLength(0);
  });

  test("clearLocalFavoriteDestinations で全件消える", () => {
    addOk({ kind: "station", station: STATION, label: "テスト駅" });
    addOk({ kind: "station", station: OTHER_STATION, label: "別のテスト駅" });

    clearLocalFavoriteDestinations();

    expect(listLocalFavoriteDestinations()).toHaveLength(0);
  });

  test("登録上限(20件)に達すると失敗を返す", () => {
    for (let i = 0; i < 20; i++) {
      const station: Station = { ...STATION, stationId: `st_${i}`, stationName: `駅${i}` };
      const result = addLocalFavoriteDestination({ kind: "station", station, label: `駅${i}` });
      expect(result.ok).toBe(true);
    }

    const overLimit = addLocalFavoriteDestination({
      kind: "station",
      station: { ...STATION, stationId: "st_over", stationName: "上限超過駅" },
      label: "上限超過駅",
    });

    expect(overLimit).toEqual({ ok: false, reason: "limit_exceeded" });
    expect(listLocalFavoriteDestinations()).toHaveLength(20);
  });

  test("壊れたJSONが保存されていても例外を投げず空配列扱いにする", () => {
    window.localStorage.setItem("deguchi-nabi:local-favorite-destinations", "{not valid json");
    expect(listLocalFavoriteDestinations()).toEqual([]);
  });

  test("パースは通るが形の不正な要素(手動編集等)は除外して読み捨てる", () => {
    const valid = addOk({ kind: "station", station: STATION, label: "テスト駅" });
    const raw = JSON.parse(window.localStorage.getItem("deguchi-nabi:local-favorite-destinations")!);
    window.localStorage.setItem(
      "deguchi-nabi:local-favorite-destinations",
      JSON.stringify([
        ...raw,
        { kind: "station" }, // station本体が欠落
        { favoriteDestinationId: "x", userId: "local", createdAt: "now", kind: "unknown" }, // kindが不正
        null,
        "not-an-object",
      ])
    );

    expect(listLocalFavoriteDestinations()).toEqual([valid]);
  });

  test("localStorageを直接書き換えて上限を超える件数を仕込んでも、読み出し時に上限件数で切り詰める", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      favoriteDestinationId: `fd_${i}`,
      userId: LOCAL_USER_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
      kind: "station" as const,
      station: { ...STATION, stationId: `st_${i}`, stationName: `駅${i}` },
      label: `駅${i}`,
    }));
    window.localStorage.setItem("deguchi-nabi:local-favorite-destinations", JSON.stringify(items));

    expect(listLocalFavoriteDestinations()).toHaveLength(20);
  });
});
