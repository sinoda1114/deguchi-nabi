import { describe, expect, test } from "vitest";
import { SHIBUYA_DECISIVE_FACILITIES } from "../shibuya-fixture";
import { resolveExitAndGateFromFacilities } from "../exit-resolution";

/** 居酒屋ウエチャベ（道玄坂2-9-2）の代表座標 */
const UECHABE_COORDINATES = { lat: 35.65692, lng: 139.69855 };
const SHIBUYA_CENTER = { lat: 35.658517, lng: 139.701334 };

describe("決定的データ: 渋谷 fixture", () => {
  test("道玄坂方面(ウエチャベ)は西口または桜丘口側の出口が選ばれる", () => {
    const result = resolveExitAndGateFromFacilities(
      SHIBUYA_DECISIVE_FACILITIES,
      UECHABE_COORDINATES,
      SHIBUYA_CENTER
    );
    expect(result.tier).toBe("exact");
    expect(result.exit).not.toBeNull();
    expect(result.gate).not.toBeNull();
    const exitName = result.exit!.name;
    expect(["西口", "桜丘口"]).toContain(exitName);
    expect(result.gate!.name.length).toBeGreaterThan(0);
  });

  test("宮益坂方面の目的地では宮益坂口が選ばれる", () => {
    const miyamasuzakaDest = { lat: 35.6612, lng: 139.7035 };
    const result = resolveExitAndGateFromFacilities(
      SHIBUYA_DECISIVE_FACILITIES,
      miyamasuzakaDest,
      SHIBUYA_CENTER
    );
    expect(result.tier).toBe("exact");
    expect(result.exit?.name).toBe("宮益坂口");
    expect(result.gate?.name).toBe("宮益坂改札");
  });
});
