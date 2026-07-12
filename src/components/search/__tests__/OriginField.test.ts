import { describe, expect, test } from "vitest";
import { resolveOriginInputValue } from "../OriginField";
import type { OriginChoice } from "../OriginField";
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
