import { describe, expect, test } from "vitest";
import { splitForDisclosure } from "@/lib/services/progressive-disclosure";

describe("splitForDisclosure", () => {
  test("先頭 primaryCount 件を primary、残りを more に分ける", () => {
    const result = splitForDisclosure([1, 2, 3, 4, 5], 2);
    expect(result.primary).toEqual([1, 2]);
    expect(result.more).toEqual([3, 4, 5]);
  });

  test("要素数が primaryCount 以下なら more は空になる", () => {
    const result = splitForDisclosure(["a", "b"], 3);
    expect(result.primary).toEqual(["a", "b"]);
    expect(result.more).toEqual([]);
  });

  test("空配列を渡すと primary・more ともに空になる", () => {
    const result = splitForDisclosure([], 2);
    expect(result.primary).toEqual([]);
    expect(result.more).toEqual([]);
  });

  test("primaryCount が 0 以下の場合は全件が more になる", () => {
    const result = splitForDisclosure([1, 2, 3], 0);
    expect(result.primary).toEqual([]);
    expect(result.more).toEqual([1, 2, 3]);
  });

  test("primaryCount が負数の場合も 0 として扱う", () => {
    const result = splitForDisclosure([1, 2, 3], -1);
    expect(result.primary).toEqual([]);
    expect(result.more).toEqual([1, 2, 3]);
  });

  test("元の配列を破壊しない", () => {
    const source = [1, 2, 3, 4];
    splitForDisclosure(source, 1);
    expect(source).toEqual([1, 2, 3, 4]);
  });
});
