import { describe, expect, test } from "vitest";
import { isGuideStepVisible } from "@/lib/services/guide-step-visibility";
import type { GuideStep, GuideStepType } from "@/lib/domain/route";
import type { Confidence, ConfidenceLevel, Provenance } from "@/lib/domain/confidence";

function confidence(level: ConfidenceLevel): Confidence {
  return { level, reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 0 };
}

function step(type: GuideStepType, level: ConfidenceLevel, provenance: Provenance): GuideStep {
  return {
    type,
    title: "テストステップ",
    instruction: "テスト用の指示文",
    landmarks: [],
    confidence: confidence(level),
    provenance,
  };
}

describe("isGuideStepVisible", () => {
  test("confidence:unavailable のステップはどの種別でも表示しない(実在確認すらできていないため)", () => {
    expect(isGuideStepVisible(step("street_exit", "unavailable", "ai_inferred"))).toBe(false);
    expect(isGuideStepVisible(step("ticket_gate", "unavailable", "surveyed"))).toBe(false);
    expect(isGuideStepVisible(step("post_gate_direction", "unavailable", "ai_inferred"))).toBe(false);
  });

  test("confidence:high のステップはどの種別・出所でも表示する", () => {
    expect(isGuideStepVisible(step("street_exit", "high", "surveyed"))).toBe(true);
    expect(isGuideStepVisible(step("post_gate_direction", "high", "ai_inferred"))).toBe(true);
  });

  test("confidence:medium のステップは種別に関わらず表示する", () => {
    expect(isGuideStepVisible(step("post_gate_direction", "medium", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("public_passage", "medium", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("underground_mall", "medium", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("street_exit", "medium", "ai_inferred"))).toBe(true);
  });

  test("confidence:low のステップは、旧・高リスク種別(post_gate_direction/public_passage/underground_mall/street_exit)を含め種別に関わらず表示する(隠さず注記で確度を伝える設計へ転換したため)", () => {
    expect(isGuideStepVisible(step("post_gate_direction", "low", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("public_passage", "low", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("underground_mall", "low", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("street_exit", "low", "ai_inferred"))).toBe(true);
  });

  test("confidence:low の旧・低リスク種別(boarding/alighting/platform_facility/ticket_gate/destination_direction)も表示する", () => {
    expect(isGuideStepVisible(step("boarding", "low", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("alighting", "low", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("platform_facility", "low", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("ticket_gate", "low", "ai_inferred"))).toBe(true);
    expect(isGuideStepVisible(step("destination_direction", "low", "ai_inferred"))).toBe(true);
  });
});
