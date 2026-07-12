import { describe, expect, test } from "vitest";
import { worstConfidenceLevel } from "@/lib/services/confidence-engine";
import type { Confidence } from "@/lib/domain/confidence";

function confidence(level: Confidence["level"]): Confidence {
  return { level, reasons: [], verifiedAt: null, expiresAt: null, sourceCount: 0 };
}

describe("worstConfidenceLevel", () => {
  test("空配列は unavailable を返す", () => {
    expect(worstConfidenceLevel([])).toBe("unavailable");
  });

  test("全て high なら high を返す", () => {
    expect(worstConfidenceLevel([confidence("high"), confidence("high")])).toBe("high");
  });

  test("high と medium が混在する場合は medium を返す", () => {
    expect(worstConfidenceLevel([confidence("high"), confidence("medium")])).toBe("medium");
  });

  test("unavailable が1件でもあれば unavailable を返す", () => {
    expect(
      worstConfidenceLevel([confidence("high"), confidence("low"), confidence("unavailable")])
    ).toBe("unavailable");
  });
});
