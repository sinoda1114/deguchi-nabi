import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Destination, Station } from "@/lib/domain/station";

const storeState: Record<string, unknown[]> = {};

vi.mock("@/lib/store/json-file-store", () => ({
  readCollection: vi.fn((name: string) => storeState[name] ?? []),
  writeCollection: vi.fn((name: string, items: unknown[]) => {
    storeState[name] = items;
  }),
}));

const {
  addFavoriteDestination,
  listFavoriteDestinations,
  removeFavoriteDestination,
} = await import("../favorite-destination-repository");

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

describe("favorite-destination-repository", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeState)) delete storeState[key];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function addOk(userId: string, input: Parameters<typeof addFavoriteDestination>[1]) {
    const result = addFavoriteDestination(userId, input);
    if (!result.ok) throw new Error("expected ok:true");
    return result.favoriteDestination;
  }

  test("addFavoriteDestination で登録した目的地が listFavoriteDestinations で取得できる", () => {
    const created = addOk("user_1", { kind: "station", station: STATION, label: "テスト駅" });

    expect(created.favoriteDestinationId).toBeTruthy();
    expect(created.userId).toBe("user_1");
    expect(created.createdAt).toBeTruthy();
    expect(listFavoriteDestinations("user_1")).toEqual([created]);
  });

  test("place の目的地も登録・取得できる", () => {
    const created = addOk("user_1", { kind: "place", destination: DESTINATION, label: "テスト施設" });

    expect(listFavoriteDestinations("user_1")).toEqual([created]);
  });

  test("listFavoriteDestinations は他ユーザーの登録を含まない", () => {
    addOk("user_1", { kind: "station", station: STATION, label: "テスト駅" });
    expect(listFavoriteDestinations("user_2")).toEqual([]);
  });

  test("同じ駅を重複登録しても増えず、既存のレコードを返す", () => {
    const first = addOk("user_1", { kind: "station", station: STATION, label: "テスト駅" });
    const second = addOk("user_1", { kind: "station", station: STATION, label: "テスト駅" });

    expect(second.favoriteDestinationId).toBe(first.favoriteDestinationId);
    expect(listFavoriteDestinations("user_1")).toHaveLength(1);
  });

  test("同じ駅でも別ユーザーなら別レコードとして登録される", () => {
    addOk("user_1", { kind: "station", station: STATION, label: "テスト駅" });
    addOk("user_2", { kind: "station", station: STATION, label: "テスト駅" });

    expect(listFavoriteDestinations("user_1")).toHaveLength(1);
    expect(listFavoriteDestinations("user_2")).toHaveLength(1);
  });

  test("異なる駅は別レコードとして登録される", () => {
    addOk("user_1", { kind: "station", station: STATION, label: "テスト駅" });
    addOk("user_1", { kind: "station", station: OTHER_STATION, label: "別のテスト駅" });

    expect(listFavoriteDestinations("user_1")).toHaveLength(2);
  });

  test("removeFavoriteDestination で削除できる", () => {
    const created = addOk("user_1", { kind: "station", station: STATION, label: "テスト駅" });

    removeFavoriteDestination("user_1", created.favoriteDestinationId);

    expect(listFavoriteDestinations("user_1")).toHaveLength(0);
  });

  test("removeFavoriteDestination は他ユーザーのIDが一致しても削除しない", () => {
    const created = addOk("user_1", { kind: "station", station: STATION, label: "テスト駅" });

    removeFavoriteDestination("user_2", created.favoriteDestinationId);

    expect(listFavoriteDestinations("user_1")).toHaveLength(1);
  });

  test("ユーザーあたりの登録上限(20件)に達すると失敗を返す", () => {
    for (let i = 0; i < 20; i++) {
      const station: Station = { ...STATION, stationId: `st_${i}`, stationName: `駅${i}` };
      const result = addFavoriteDestination("user_1", {
        kind: "station",
        station,
        label: `駅${i}`,
      });
      expect(result.ok).toBe(true);
    }

    const overLimit = addFavoriteDestination("user_1", {
      kind: "station",
      station: { ...STATION, stationId: "st_over", stationName: "上限超過駅" },
      label: "上限超過駅",
    });

    expect(overLimit).toEqual({ ok: false, reason: "limit_exceeded" });
    expect(listFavoriteDestinations("user_1")).toHaveLength(20);
  });

  test("上限に達していても既に登録済みの駅は再登録できる(重複チェックが上限より優先)", () => {
    for (let i = 0; i < 20; i++) {
      const station: Station = { ...STATION, stationId: `st_${i}`, stationName: `駅${i}` };
      addFavoriteDestination("user_1", { kind: "station", station, label: `駅${i}` });
    }

    const result = addFavoriteDestination("user_1", {
      kind: "station",
      station: { ...STATION, stationId: "st_0", stationName: "駅0" },
      label: "駅0",
    });

    expect(result.ok).toBe(true);
    expect(listFavoriteDestinations("user_1")).toHaveLength(20);
  });
});
