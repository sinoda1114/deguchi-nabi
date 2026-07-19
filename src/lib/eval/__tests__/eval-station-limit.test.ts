import { describe, expect, test } from "vitest";
import { resolveEvalStationLimit } from "../eval-station-limit";

describe("resolveEvalStationLimit", () => {
  test("未指定ならdatasetLengthをそのまま返す", () => {
    expect(resolveEvalStationLimit(undefined, 20)).toBe(20);
  });

  test("正の整数かつdatasetLength以下ならその値を返す", () => {
    expect(resolveEvalStationLimit("3", 20)).toBe(3);
  });

  test("datasetLengthちょうどでも有効", () => {
    expect(resolveEvalStationLimit("20", 20)).toBe(20);
  });

  test("数値でない文字列(NaN)は例外を投げる(/ai-review指摘、Medium: 不正値がslice(0, NaN)で0駅評価となり、常に成功扱いになってしまう問題)", () => {
    expect(() => resolveEvalStationLimit("abc", 20)).toThrow(/EVAL_STATION_LIMIT/);
  });

  test("0は例外を投げる(0駅評価は常に成功扱いになるため)", () => {
    expect(() => resolveEvalStationLimit("0", 20)).toThrow(/EVAL_STATION_LIMIT/);
  });

  test("負数は例外を投げる", () => {
    expect(() => resolveEvalStationLimit("-1", 20)).toThrow(/EVAL_STATION_LIMIT/);
  });

  test("datasetLengthを超える値は例外を投げる", () => {
    expect(() => resolveEvalStationLimit("21", 20)).toThrow(/EVAL_STATION_LIMIT/);
  });

  test("小数は例外を投げる", () => {
    expect(() => resolveEvalStationLimit("3.5", 20)).toThrow(/EVAL_STATION_LIMIT/);
  });
});
