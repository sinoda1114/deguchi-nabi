import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteOverviewContent } from "@/components/result/RouteOverviewContent";
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
  },
};

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "改札・出口情報を確認できません。",
};

describe("RouteOverviewContent", () => {
  test("号車・出口・乗換回数・迷いにくさスコアを表示する", async () => {
    const element = await RouteOverviewContent({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
      mode: "easy",
      transferCount: 0,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("8号車");
    expect(html).toContain("前方");
    expect(html).toContain("東口");
    expect(html).toContain("乗換0回");
    expect(html).toContain("迷いにくさ");
  });

  test("号車情報が無い場合は確認できない旨を表示する", async () => {
    const element = await RouteOverviewContent({
      trainSegmentsPromise: Promise.resolve([{ ...TRAIN_SEGMENT, boardingPosition: null }]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
      mode: "easy",
      transferCount: 0,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("確認できません");
  });

  test("facilitiesがok:falseでも号車・乗換回数は独立に表示を続け、出口欄のみ確認できない旨にする(出口だけの部分障害でカード全体が空になる可用性の後退を避けるため)", async () => {
    const element = await RouteOverviewContent({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(NG_RESULT),
      mode: "easy",
      transferCount: 2,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("8号車");
    expect(html).toContain("乗換2回");
    expect(html).toContain("改札・出口情報を確認できません。");
  });
});
