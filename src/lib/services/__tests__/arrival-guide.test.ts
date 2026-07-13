import { describe, expect, test, vi } from "vitest";
import { buildArrivalGuide } from "@/lib/services/arrival-guide";
import type { FacilitiesBuildSuccess } from "@/lib/services/route-search";
import type { StationFacility } from "@/lib/domain/station";
import type { Confidence } from "@/lib/domain/confidence";
import type { GuideStep } from "@/lib/domain/route";

const highConfidence: Confidence = {
  level: "high",
  reasons: ["公式構内図で確認済み"],
  verifiedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  sourceCount: 1,
};

type BaseResult = Pick<FacilitiesBuildSuccess, "gate" | "exit" | "approximateDirectionLabel">;

function baseResult(overrides: Partial<BaseResult> = {}): BaseResult {
  return {
    gate: null,
    exit: null,
    approximateDirectionLabel: null,
    ...overrides,
  };
}

function facility(overrides: Partial<StationFacility> = {}): StationFacility {
  return {
    facilityId: "fac_1",
    stationId: "st_1",
    facilityType: "gate",
    name: "南改札",
    level: "地上1階",
    accessible: true,
    coordinates: null,
    connectedGateId: null,
    confidence: highConfidence,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    provenance: "surveyed",
    ...overrides,
  };
}

function guideStep(overrides: Partial<GuideStep> = {}): GuideStep {
  return {
    type: "public_passage",
    title: "地下通路",
    instruction: "地下通路を直進してください。",
    landmarks: [],
    confidence: { level: "medium", reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 0 },
    provenance: "ai_inferred",
    ...overrides,
  };
}

describe("buildArrivalGuide", () => {
  test("gateとexitが両方確定していれば ticket_gate → street_exit の順でステップを組み立てる", async () => {
    const guide = await buildArrivalGuide(
      baseResult({
        gate: facility({ facilityId: "fac_gate", facilityType: "gate", name: "南改札" }),
        exit: facility({ facilityId: "fac_exit", facilityType: "exit", name: "A7出口" }),
      }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      {}
    );

    expect(guide.steps.map((s) => s.type)).toEqual(["ticket_gate", "street_exit"]);
    expect(guide.steps[0].title).toBe("南改札");
    expect(guide.steps[1].title).toBe("A7出口");
  });

  test("gateがnullの場合はticket_gateステップを生成しない(推測で埋めない)", async () => {
    const guide = await buildArrivalGuide(
      baseResult({ exit: facility({ facilityType: "exit", name: "A7出口" }) }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      {}
    );
    expect(guide.steps.map((s) => s.type)).toEqual(["street_exit"]);
  });

  test("gate・exitともnullでもクラッシュせず空のstepsを返す", async () => {
    const guide = await buildArrivalGuide(baseResult(), "st_1", "テスト駅", null, "easy", false, {});
    expect(guide.steps).toEqual([]);
  });

  test("approximateDirectionLabelをdestinationDirectionへそのまま引き継ぐ", async () => {
    const guide = await buildArrivalGuide(
      baseResult({ approximateDirectionLabel: "南西" }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      {}
    );
    expect(guide.destinationDirection).toBe("南西");
  });

  test("facility.provenanceがai_inferredの場合、confidence:highでもmediumに格下げする", async () => {
    const guide = await buildArrivalGuide(
      baseResult({ gate: facility({ provenance: "ai_inferred", confidence: highConfidence }) }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      {}
    );
    expect(guide.steps[0].confidence.level).toBe("medium");
    expect(guide.steps[0].provenance).toBe("ai_inferred");
  });

  test("facility.provenance未設定の場合は安全側のai_inferredとして扱う(medium格下げ)", async () => {
    const guide = await buildArrivalGuide(
      baseResult({ gate: facility({ provenance: undefined, confidence: highConfidence }) }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      {}
    );
    expect(guide.steps[0].confidence.level).toBe("medium");
    expect(guide.steps[0].provenance).toBe("ai_inferred");
  });

  test("facility.provenanceがsurveyedならconfidence:highをそのまま維持する", async () => {
    const guide = await buildArrivalGuide(
      baseResult({ gate: facility({ provenance: "surveyed", confidence: highConfidence }) }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      {}
    );
    expect(guide.steps[0].confidence.level).toBe("high");
  });

  test("gate・exit両方確定(surveyed)・経路も非AI生成であればAI生成のナラティブステップをticket_gateとstreet_exitの間に挿入する", async () => {
    const getArrivalGuideNarrativeSteps = vi
      .fn()
      .mockResolvedValue([guideStep({ type: "public_passage", title: "地下通路" })]);

    const guide = await buildArrivalGuide(
      baseResult({
        gate: facility({ facilityType: "gate", name: "南改札", provenance: "surveyed" }),
        exit: facility({ facilityType: "exit", name: "A7出口", provenance: "surveyed" }),
      }),
      "st_1",
      "テスト駅",
      { lat: 35.0, lng: 139.0 },
      "easy",
      false,
      { getArrivalGuideNarrativeSteps }
    );

    expect(guide.steps.map((s) => s.type)).toEqual(["ticket_gate", "public_passage", "street_exit"]);
    expect(getArrivalGuideNarrativeSteps).toHaveBeenCalledWith(
      "st_1",
      "テスト駅",
      "南改札",
      "A7出口",
      { lat: 35.0, lng: 139.0 }
    );
  });

  test("gateまたはexitが未確定の場合はナラティブステップ生成を呼ばない(検索対象の名称が無いため)", async () => {
    const getArrivalGuideNarrativeSteps = vi.fn().mockResolvedValue([]);

    await buildArrivalGuide(
      baseResult({ exit: facility({ facilityType: "exit", name: "A7出口" }) }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      { getArrivalGuideNarrativeSteps }
    );

    expect(getArrivalGuideNarrativeSteps).not.toHaveBeenCalled();
  });

  test("accessibleモードではナラティブ生成を呼ばない(段差・階段回避を考慮しないプロンプトで車椅子利用者等に危険な導線を案内しないため)", async () => {
    const getArrivalGuideNarrativeSteps = vi.fn().mockResolvedValue([]);

    await buildArrivalGuide(
      baseResult({
        gate: facility({ facilityType: "gate", name: "南改札", provenance: "surveyed" }),
        exit: facility({ facilityType: "exit", name: "A7出口", provenance: "surveyed" }),
      }),
      "st_1",
      "テスト駅",
      null,
      "accessible",
      false,
      { getArrivalGuideNarrativeSteps }
    );

    expect(getArrivalGuideNarrativeSteps).not.toHaveBeenCalled();
  });

  test("gate・exitのいずれかがai_inferred(AI推定)の場合はナラティブ生成を呼ばない(不確かな施設名の間をさらにAIに推測させない)", async () => {
    const getArrivalGuideNarrativeSteps = vi.fn().mockResolvedValue([]);

    await buildArrivalGuide(
      baseResult({
        gate: facility({ facilityType: "gate", name: "南改札", provenance: "ai_inferred" }),
        exit: facility({ facilityType: "exit", name: "A7出口", provenance: "surveyed" }),
      }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      { getArrivalGuideNarrativeSteps }
    );

    expect(getArrivalGuideNarrativeSteps).not.toHaveBeenCalled();
  });

  test("経路自体がAI生成(isRouteAiGenerated=true)の場合はgate/exitがsurveyedでもナラティブ生成を呼ばない(1リクエストで課金対象のAI呼び出しが2系統重ならないようにするため。セキュリティレビュー指摘に基づく)", async () => {
    const getArrivalGuideNarrativeSteps = vi.fn().mockResolvedValue([]);

    await buildArrivalGuide(
      baseResult({
        gate: facility({ facilityType: "gate", name: "南改札", provenance: "surveyed" }),
        exit: facility({ facilityType: "exit", name: "A7出口", provenance: "surveyed" }),
      }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      true,
      { getArrivalGuideNarrativeSteps }
    );

    expect(getArrivalGuideNarrativeSteps).not.toHaveBeenCalled();
  });

  test("stationProviderがgetArrivalGuideNarrativeStepsを実装していなくてもクラッシュしない", async () => {
    const guide = await buildArrivalGuide(
      baseResult({
        gate: facility({ facilityType: "gate", name: "南改札", provenance: "surveyed" }),
        exit: facility({ facilityType: "exit", name: "A7出口", provenance: "surveyed" }),
      }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      {}
    );
    expect(guide.steps.map((s) => s.type)).toEqual(["ticket_gate", "street_exit"]);
  });

  test("実害の大きい高リスクステップがconfidence:lowで返ってきた場合は最終結果から除外する(isGuideStepVisibleによるフィルタ)", async () => {
    const getArrivalGuideNarrativeSteps = vi.fn().mockResolvedValue([
      guideStep({
        type: "post_gate_direction",
        confidence: { level: "low", reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 0 },
      }),
    ]);

    const guide = await buildArrivalGuide(
      baseResult({
        gate: facility({ facilityType: "gate", name: "南改札", provenance: "surveyed" }),
        exit: facility({ facilityType: "exit", name: "A7出口", provenance: "surveyed" }),
      }),
      "st_1",
      "テスト駅",
      null,
      "easy",
      false,
      { getArrivalGuideNarrativeSteps }
    );

    expect(guide.steps.map((s) => s.type)).toEqual(["ticket_gate", "street_exit"]);
  });
});
