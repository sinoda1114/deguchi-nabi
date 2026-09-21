import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteDiagramSection } from "@/components/result/RouteDiagramSection";
import { RouteDiagramSectionSkeleton } from "@/components/result/RouteDiagramSectionSkeleton";
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
  boardingPosition: { carNumber: 5, doorPosition: "中央", reason: "テスト理由" },
  facilities: [],
  instruction: "テスト線で5号車付近に乗車してください。",
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
      instruction: "A1出口から出てください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    recommendedExit: "A1出口",
    facilityRecommendation: { state: "unavailable", reason: "test" },
    elevator: null,
    hasApproximateGuidance: false,
    hasAlternativesGuidance: false,
    approximateDirectionLabel: null,
    unifiedBoardingPosition: null,
    omitIndependentBoarding: false,
    gateExitRelation: { kind: "separate_exit", reason: "test" },
    arrivalGuide: { steps: [], destinationDirection: null, facility: { state: "unavailable", reason: "test" } },
  },
};

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "改札・出口情報を確認できません。",
};

describe("RouteDiagramSection", () => {
  test("train区間とfacilitiesを結合した経路図を描画する", async () => {
    const element = await RouteDiagramSection({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
      destinationCoordinates: { lat: 35.4657, lng: 139.622 },
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("出発駅");
    expect(html).toContain("到着駅");
    expect(html).toContain("5号車");
  });

  test("出口が確認できない場合でも目的地座標があれば Maps リンクを出口カードの下に出す", async () => {
    const element = await RouteDiagramSection({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve({
        ...OK_RESULT,
        result: {
          ...OK_RESULT.result,
          recommendedExit: "確認できません",
          exitSegment: {
            ...OK_RESULT.result.exitSegment,
            instruction: "出口は確認できません。",
            facilities: [],
          },
        },
      }),
      destinationCoordinates: { lat: 35.4657, lng: 139.622 },
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("出口は確認できません。");
    expect(html).toContain("Google Mapsで目的地を開く");
    expect(html).toContain("35.4657");
    expect(html).not.toContain("origin=");
  });

  test("目的地座標が無いときは Maps リンクを出さない", async () => {
    const element = await RouteDiagramSection({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(OK_RESULT),
      destinationCoordinates: null,
    });
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("Google Maps");
  });

  test("facilitiesがok:falseの場合はエラーメッセージを描画する", async () => {
    const element = await RouteDiagramSection({
      trainSegmentsPromise: Promise.resolve([TRAIN_SEGMENT]),
      facilitiesPromise: Promise.resolve(NG_RESULT),
      destinationCoordinates: { lat: 35.4657, lng: 139.622 },
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("改札・出口情報を確認できません。");
  });
});

describe("RouteDiagramSectionSkeleton", () => {
  test("aria-hiddenなプレースホルダーを描画する", () => {
    const html = renderToStaticMarkup(<RouteDiagramSectionSkeleton />);
    expect(html).toContain("skeleton-shimmer");
    expect(html).toContain('aria-hidden="true"');
  });
});
