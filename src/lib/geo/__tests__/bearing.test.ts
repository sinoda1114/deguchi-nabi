import { describe, expect, test } from "vitest";
import { bearingDegrees, bearingDifferenceDegrees, compassLabel } from "../bearing";

describe("bearingDegrees", () => {
  test("真北の地点への方位角は0度に近い", () => {
    expect(bearingDegrees(35.0, 139.0, 35.1, 139.0)).toBeCloseTo(0, 0);
  });

  test("真東の地点への方位角は90度に近い", () => {
    expect(bearingDegrees(35.0, 139.0, 35.0, 139.1)).toBeCloseTo(90, 0);
  });

  test("真南の地点への方位角は180度に近い", () => {
    expect(bearingDegrees(35.0, 139.0, 34.9, 139.0)).toBeCloseTo(180, 0);
  });

  test("真西の地点への方位角は270度に近い", () => {
    expect(bearingDegrees(35.0, 139.0, 35.0, 138.9)).toBeCloseTo(270, 0);
  });
});

describe("bearingDifferenceDegrees", () => {
  test("0度と90度の差は90度", () => {
    expect(bearingDifferenceDegrees(0, 90)).toBeCloseTo(90, 5);
  });

  test("0度と180度の差は180度(最大)", () => {
    expect(bearingDifferenceDegrees(0, 180)).toBeCloseTo(180, 5);
  });

  test("350度と10度の差は20度(0度をまたぐ場合も最短角度を返す)", () => {
    expect(bearingDifferenceDegrees(350, 10)).toBeCloseTo(20, 5);
  });

  test("0度と200度の差は160度(180度を超える差は反対側から測る)", () => {
    expect(bearingDifferenceDegrees(0, 200)).toBeCloseTo(160, 5);
  });

  test("同じ方位角同士の差は0度", () => {
    expect(bearingDifferenceDegrees(45, 45)).toBeCloseTo(0, 5);
  });
});

describe("compassLabel", () => {
  test.each([
    [0, "北"],
    [45, "北東"],
    [90, "東"],
    [135, "南東"],
    [180, "南"],
    [225, "南西"],
    [270, "西"],
    [315, "北西"],
    [360, "北"],
  ])("方位角%d度は%sと表示する", (bearing, expected) => {
    expect(compassLabel(bearing)).toBe(expected);
  });

  test("境界値(22度)は北のまま", () => {
    expect(compassLabel(22)).toBe("北");
  });

  test("境界値(23度)は北東に切り替わる", () => {
    expect(compassLabel(23)).toBe("北東");
  });
});
