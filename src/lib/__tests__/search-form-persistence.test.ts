// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import {
  loadSearchFormDraft,
  saveSearchFormDraft,
  type SearchFormDraft,
} from "@/lib/search-form-persistence";

const DRAFT: SearchFormDraft = {
  origin: { type: "station", stationId: "st_1", label: "テスト駅" },
  destination: {
    kind: "station",
    station: {
      stationId: "st_2",
      stationName: "行き先駅",
      operator: "テスト鉄道",
      lines: ["テスト線"],
      prefecture: "東京都",
      latitude: 0,
      longitude: 0,
    },
  },
  mode: "accessible",
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("saveSearchFormDraft / loadSearchFormDraft", () => {
  test("保存した内容をそのまま復元できる", () => {
    saveSearchFormDraft(DRAFT);
    expect(loadSearchFormDraft()).toEqual(DRAFT);
  });

  test("未保存の場合は null を返す", () => {
    expect(loadSearchFormDraft()).toBeNull();
  });

  test("壊れたJSONが保存されていても null を返す", () => {
    window.sessionStorage.setItem("deguchi-nabi:search-form-draft", "{not-json");
    expect(loadSearchFormDraft()).toBeNull();
  });
});
