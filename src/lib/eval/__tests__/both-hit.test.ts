import { describe, expect, test } from "vitest";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import type { FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import { lowConfidence } from "@/lib/domain/confidence";

function named(name: string): NamedFacility {
  return { name, confidence: lowConfidence("test"), provenance: "ai_inferred" };
}

describe("isScoringBothHit", () => {
  test("confirmed で改札と出口の両方があるときだけ true", () => {
    const rec: FacilityRecommendation = {
      state: "confirmed",
      pair: { gate: named("道玄坂改札"), exit: named("A1出口"), reason: null },
    };
    expect(isScoringBothHit(rec)).toBe(true);
  });

  test("改札のみは不合格(Option A 不採用)", () => {
    const rec: FacilityRecommendation = {
      state: "confirmed",
      pair: { gate: named("道玄坂改札"), exit: null, reason: null },
    };
    expect(isScoringBothHit(rec)).toBe(false);
  });

  test("出口のみは不合格", () => {
    const rec: FacilityRecommendation = {
      state: "confirmed",
      pair: { gate: null, exit: named("A1出口"), reason: null },
    };
    expect(isScoringBothHit(rec)).toBe(false);
  });

  test("方角だけの案内相当(片方も無い)は不合格", () => {
    const rec: FacilityRecommendation = {
      state: "unavailable",
      reason: "西側",
    };
    expect(isScoringBothHit(rec)).toBe(false);
  });

  test("unavailable は不合格", () => {
    expect(isScoringBothHit({ state: "unavailable", reason: "x" })).toBe(false);
  });
});
