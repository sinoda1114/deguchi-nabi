import { describe, expect, test } from "vitest";
import {
  buildHomeStationOriginChoice,
  repairStaleOriginChoice,
  resolveOriginInputValue,
} from "../OriginField";
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

describe("repairStaleOriginChoice", () => {
  // 修正前バージョンでは、未ログイン時でも { type: "home_station" } を
  // sessionStorageの下書き(search-form-persistence)に保存していたため、
  // 過去に保存された壊れた下書きがページ再訪問時にそのまま復元され、
  // 修正後もエラーが再発する不具合があった。この関数はページロード時に
  // 毎回そのような壊れた状態を検出し、安全な形へ補正する。

  test("ログイン中は何もしない(既存のoriginをそのまま返す)", () => {
    const origin: OriginChoice = { type: "home_station", label: "渋谷駅" };
    const user: User = {
      userId: "user_1",
      email: "user@example.com",
      displayName: "テストユーザー",
      homeStationId: "st_shibuya",
      plan: "free",
      locale: "ja",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const result = repairStaleOriginChoice(origin, user, HOME_STATION);
    expect(result).toBe(origin);
  });

  test("未ログイン中に type: home_station の壊れた下書きが残っている場合、デフォルト駅を使ってtype: stationに補正する", () => {
    const staleOrigin: OriginChoice = { type: "home_station", label: "西谷駅" };
    const result = repairStaleOriginChoice(staleOrigin, null, HOME_STATION);
    expect(result).toEqual({ type: "station", stationId: "st_shibuya", label: "渋谷駅" });
  });

  test("未ログイン中にtype: home_stationの下書きが残っているが、デフォルト駅も無い(取得失敗等)場合はnullにする(送信不能な状態を維持しないため)", () => {
    const staleOrigin: OriginChoice = { type: "home_station", label: "西谷駅" };
    const result = repairStaleOriginChoice(staleOrigin, null, null);
    expect(result).toBeNull();
  });

  test("未ログイン中にoriginが未選択で、デフォルト駅があれば自動選択する(従来の自動選択動作)", () => {
    const result = repairStaleOriginChoice(null, null, HOME_STATION);
    expect(result).toEqual({ type: "station", stationId: "st_shibuya", label: "渋谷駅" });
  });

  test("未ログイン中に既にtype: stationが選択されていれば変更しない", () => {
    const origin: OriginChoice = { type: "station", stationId: "st_nishiya", label: "西谷駅" };
    const result = repairStaleOriginChoice(origin, null, HOME_STATION);
    expect(result).toBe(origin);
  });
});
