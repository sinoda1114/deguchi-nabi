import { describe, expect, test } from "vitest";
import {
  isSameStationRailRoute,
  ON_STATION_RAIL_LINE_LABEL,
} from "../same-station-route";

describe("isSameStationRailRoute", () => {
  test("同一の HeartRails stationId なら true", () => {
    const id = "hr_%E6%A0%84_136.9080_35.1700";
    expect(isSameStationRailRoute(id, id)).toBe(true);
  });

  test("異なる stationId なら false", () => {
    expect(
      isSameStationRailRoute(
        "hr_%E6%A0%84_136.9080_35.1700",
        "hr_%E5%A0%82%E5%B1%B1_139.7011_35.6586"
      )
    ).toBe(false);
  });

  test("ON_STATION_RAIL_LINE_LABEL は非空", () => {
    expect(ON_STATION_RAIL_LINE_LABEL.length).toBeGreaterThan(0);
  });
});
