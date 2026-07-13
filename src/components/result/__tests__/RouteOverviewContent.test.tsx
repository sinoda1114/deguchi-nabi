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
    arrivalGuide: { steps: [], destinationDirection: null },
  },
};

/**
 * RouteOverviewContent は乗車位置・改札・出口・迷いにくさをそれぞれ独立した
 * Suspense境界(RouteBoardingStat/RouteGateStat/RouteExitStat/RouteEaseScoreStat)に
 * 委譲するレイアウト専用コンポーネントになった。各欄の実データ描画は
 * それぞれの単体テスト(RouteBoardingStat.test.tsx/RouteGateStat.test.tsx/
 * RouteExitStat.test.tsx等)で検証済みのため、ここでは「乗換回数(Promise不要で
 * 同期表示)とレイアウトが崩れていないこと」のみ検証する。
 */
describe("RouteOverviewContent", () => {
  test("乗換回数を同期表示する(乗車位置・改札・出口・迷いにくさの解決は待たない)", () => {
    const element = RouteOverviewContent({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
      mode: "easy",
      transferCount: 2,
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("乗換2回");
  });
});
