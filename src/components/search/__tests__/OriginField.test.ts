import { describe, expect, test } from "vitest";
import { buildHomeStationOriginChoice, resolveOriginInputValue } from "../OriginField";
import type { OriginChoice } from "../OriginField";
import type { Station } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";

const HOME_STATION: Station = {
  stationId: "st_shibuya",
  stationName: "渋谷駅",
  operator: "東急電鉄",
  lines: ["東急東横線"],
  prefecture: "東京都",
  latitude: 35.658,
  longitude: 139.7016,
};

describe("resolveOriginInputValue", () => {
  test("未選択なら入力中のクエリ文字列を返す", () => {
    const result = resolveOriginInputValue(null, HOME_STATION, "西谷");
    expect(result).toBe("西谷");
  });

  test("home_station選択時は最新のhomeStation.stationNameを返す(sessionStorageの古いlabelより優先)", () => {
    const staleValue: OriginChoice = { type: "home_station", label: "新宿駅" };
    const result = resolveOriginInputValue(staleValue, HOME_STATION, "");
    expect(result).toBe("渋谷駅");
  });

  test("home_station選択時にhomeStationがnull(取得失敗等)ならvalue.labelにフォールバックする", () => {
    const staleValue: OriginChoice = { type: "home_station", label: "新宿駅" };
    const result = resolveOriginInputValue(staleValue, null, "");
    expect(result).toBe("新宿駅");
  });

  test("station選択時はvalue.labelをそのまま返す", () => {
    const value: OriginChoice = { type: "station", stationId: "st_nishiya", label: "西谷駅" };
    const result = resolveOriginInputValue(value, HOME_STATION, "");
    expect(result).toBe("西谷駅");
  });
});

describe("buildHomeStationOriginChoice", () => {
  const USER: User = {
    userId: "user_1",
    email: "user@example.com",
    displayName: "テストユーザー",
    homeStationId: "st_shibuya",
    plan: "free",
    locale: "ja",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  test("ログイン中はサーバー側のhomeStation選択として type: home_station を返す", () => {
    const result = buildHomeStationOriginChoice(USER, HOME_STATION);
    expect(result).toEqual({ type: "home_station", label: "渋谷駅" });
  });

  test("未ログイン時は type: home_station を使わず、具体的な駅IDを持つ type: station を返す(サーバー側はhome_stationをログインユーザーのDB登録駅としてしか解釈できず、未ログインだと「最寄り駅が登録されていません」エラーになるため)", () => {
    const result = buildHomeStationOriginChoice(null, HOME_STATION);
    expect(result).toEqual({ type: "station", stationId: "st_shibuya", label: "渋谷駅" });
  });
});
