import { describe, expect, test } from "vitest";
import { isScoringBothHit } from "../both-hit";
import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";
import { lowConfidence } from "@/lib/domain/confidence";

function named(name: string) {
  return { name, confidence: lowConfidence("test") };
}

describe("isScoringBothHit", () => {
  test("confirmedで改札と出口の両方があるときだけtrue", () => {
    const rec: FacilityRecommendation = {
      state: "confirmed",
      pair: { gate: named("道玄坂改札"), exit: named("A1出口"), reason: null },
    };
    expect(isScoringBothHit(rec)).toBe(true);
  });

  test("confirmedでも改札だけのときはfalse（Option A不採用）", () => {
    const rec: FacilityRecommendation = {
      state: "confirmed",
      pair: { gate: named("道玄坂改札"), exit: null, reason: null },
    };
    expect(isScoringBothHit(rec)).toBe(false);
  });

  test("confirmedでも出口だけのときはfalse", () => {
    const rec: FacilityRecommendation = {
      state: "confirmed",
      pair: { gate: null, exit: named("A1出口"), reason: null },
    };
    expect(isScoringBothHit(rec)).toBe(false);
  });

  test("alternativesは両方揃った組が1つでもあればtrue", () => {
    const rec: FacilityRecommendation = {
      state: "alternatives",
      pairs: [
        { gate: named("ハチ公改札"), exit: null, reason: null },
        { gate: named("道玄坂改札"), exit: named("A1出口"), reason: null },
      ],
    };
    expect(isScoringBothHit(rec)).toBe(true);
  });

  test("unavailableはfalse", () => {
    const rec: FacilityRecommendation = {
      state: "unavailable",
      reason: "改札・出口の情報が確認できませんでした",
    };
    expect(isScoringBothHit(rec)).toBe(false);
  });
});
