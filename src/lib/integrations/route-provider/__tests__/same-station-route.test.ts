import { describe, expect, test } from "vitest";
import type { Station } from "@/lib/domain/station";
import {
  isSameStationRailRoute,
  ON_STATION_RAIL_LINE_LABEL,
  SAME_STATION_MAX_DISTANCE_METERS,
} from "../same-station-route";

describe("isSameStationRailRoute", () => {
  test("同一の HeartRails stationId なら true", () => {
    const id = "hr_%E6%A0%84_136.9080_35.1700";
    expect(isSameStationRailRoute(id, id)).toBe(true);
  });

  test("遠い別駅なら false", () => {
    expect(
      isSameStationRailRoute(
        "hr_%E6%A0%84_136.9080_35.1700",
        "hr_%E5%A0%82%E5%B1%B1_139.7011_35.6586"
      )
    ).toBe(false);
  });

  test("なんばと難波は表記ゆれとして同一構内", () => {
    const nambaHira: Station = {
      stationId: "hr_%E3%81%AA%E3%82%93%E3%81%B0_135.5003_34.6663",
      stationName: "なんば駅",
      operator: "",
      lines: [],
      prefecture: "大阪府",
      latitude: 34.6663,
      longitude: 135.5003,
    };
    const nambaKanji: Station = {
      stationId: "hr_%E9%9B%A2%E6%B3%A2_135.5019_34.6636",
      stationName: "難波駅",
      operator: "",
      lines: [],
      prefecture: "大阪府",
      latitude: 34.6636,
      longitude: 135.5019,
    };
    expect(
      isSameStationRailRoute(
        nambaHira.stationId,
        nambaKanji.stationId,
        nambaHira,
        nambaKanji
      )
    ).toBe(true);
  });

  test("博多の座標クラスタ差は同一構内とみなす", () => {
    const a: Station = {
      stationId: "hr_%E5%8D%9A%E5%A4%9A_130.4206_33.5900",
      stationName: "博多駅",
      operator: "",
      lines: [],
      prefecture: "福岡県",
      latitude: 33.59,
      longitude: 130.4206,
    };
    const b: Station = {
      stationId: "hr_%E5%8D%9A%E5%A4%9A_130.4183_33.5897",
      stationName: "博多駅",
      operator: "",
      lines: [],
      prefecture: "福岡県",
      latitude: 33.5897,
      longitude: 130.4183,
    };
    expect(isSameStationRailRoute(a.stationId, b.stationId, a, b)).toBe(true);
  });

  test("ON_STATION_RAIL_LINE_LABEL は非空", () => {
    expect(ON_STATION_RAIL_LINE_LABEL.length).toBeGreaterThan(0);
  });

  test("SAME_STATION_MAX_DISTANCE_METERS は正の数", () => {
    expect(SAME_STATION_MAX_DISTANCE_METERS).toBeGreaterThan(0);
  });
});
