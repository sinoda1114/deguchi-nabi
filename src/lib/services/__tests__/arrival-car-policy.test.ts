import { describe, expect, test } from "vitest";
import { classifyFacilityRecommendation } from "@/lib/domain/facility-recommendation";
import { lowConfidence } from "@/lib/domain/confidence";
import { arrivalCarPolicyFrom } from "@/lib/services/arrival-car-policy";
import type { UnifiedBoardingPosition } from "@/lib/services/arrival-car-policy";

const confidence = lowConfidence("test");
const position: UnifiedBoardingPosition = {
  carNumber: 8,
  doorPosition: "前方",
  reason: "test",
  confidence,
};

function confirmedBoth(gateName: string, exitName: string) {
  return classifyFacilityRecommendation([
    {
      gate: { name: gateName, confidence },
      exit: { name: exitName, confidence },
      reason: null,
    },
  ]);
}

describe("arrivalCarPolicyFrom", () => {
  test("unified 号車があればそれが勝つ", () => {
    const policy = arrivalCarPolicyFrom({
      unifiedBoardingPosition: position,
      omitIndependentBoarding: true,
      facilityRecommendation: confirmedBoth("道玄坂改札", "A1出口"),
    });
    expect(policy).toEqual({ type: "unified", position });
  });

  test("omit かつ改札1択なら forGate", () => {
    const policy = arrivalCarPolicyFrom({
      unifiedBoardingPosition: null,
      omitIndependentBoarding: true,
      facilityRecommendation: confirmedBoth("道玄坂改札", "A1出口"),
    });
    expect(policy.type).toBe("forGate");
    if (policy.type === "forGate") {
      expect(policy.gate.name).toBe("道玄坂改札");
    }
  });

  test("omit かつ改札が複数なら none", () => {
    const rec = classifyFacilityRecommendation([
      { gate: { name: "道玄坂改札", confidence }, exit: { name: "A1出口", confidence }, reason: null },
      { gate: { name: "ハチ公改札", confidence }, exit: { name: "ハチ公口", confidence }, reason: null },
    ]);
    expect(
      arrivalCarPolicyFrom({
        unifiedBoardingPosition: null,
        omitIndependentBoarding: true,
        facilityRecommendation: rec,
      })
    ).toEqual({ type: "none" });
  });

  test("omit でなければ independent", () => {
    expect(
      arrivalCarPolicyFrom({
        unifiedBoardingPosition: null,
        omitIndependentBoarding: false,
        facilityRecommendation: confirmedBoth("道玄坂改札", "A1出口"),
      })
    ).toEqual({ type: "independent" });
  });
});
