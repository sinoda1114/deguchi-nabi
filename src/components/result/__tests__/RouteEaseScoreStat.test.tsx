import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteEaseScoreStat } from "@/components/result/RouteEaseScoreStat";
import type { RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

const TRAIN_SEGMENT: RouteSegment = {
  type: "train",
  from: "出発駅",
  to: "到着駅",
  line: "テスト線",
  direction: "到着駅方面",
  platform: "1",
  boardingPosition: { carNumber: 8, doorPosition: "前方", reason: "テスト理由" },
  facilities: [],
  instruction: "テスト線で8号車付近に乗車してください。",
  confidence: highConfidence,
  sourceReferences: [],
  warnings: [],
};

const OK_RESULT: FacilitiesSearchResult = {
  ok: true,
  result: {
    transferSegment: {
      type: "transfer",
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: "中央改札方面",
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "中央改札へ向かってください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    exitSegment: {
      type: "exit",
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: null,
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "東口から出てください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    recommendedExit: "東口",
    gate: null,
    exit: null,
    elevator: null,
    hasApproximateGuidance: false,
    approximateDirectionLabel: null,
    unifiedBoardingPosition: null,
    arrivalGuide: { steps: [], destinationDirection: null },
  },
};

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "改札・出口情報を確認できません。",
};

describe("RouteEaseScoreStat", () => {
  test("facilitiesがok:trueの場合は迷いにくさスコアを表示する", async () => {
    const element = await RouteEaseScoreStat({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
      mode: "easy",
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("迷いにくさ");
  });

  test("facilitiesがok:falseの場合は理由を表示する", async () => {
    const element = await RouteEaseScoreStat({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(NG_RESULT),
      mode: "easy",
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("改札・出口情報を確認できません。");
  });

  test("facilitiesが失敗した場合、trainSegmentsPromiseが未解決のままでもエラー理由を返す(不要な待機をしないことの回帰テスト)", async () => {
    const neverResolvingTrainSegments: Promise<RouteSegment[]> = new Promise(() => {});
    const element = await RouteEaseScoreStat({
      trainSegmentsPromise: neverResolvingTrainSegments,
      facilitiesPromise: Promise.resolve(NG_RESULT),
      mode: "easy",
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("改札・出口情報を確認できません。");
  });
});
