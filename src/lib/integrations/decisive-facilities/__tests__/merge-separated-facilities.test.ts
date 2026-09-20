import { describe, expect, test } from "vitest";
import { pickGateForExit, resolveExitRecommendation } from "@/lib/services/route-search";
import { SHIBUYA_DECISIVE_FACILITIES } from "../shibuya-fixture";
import { mergeSeparatedFacilityPair } from "../merge-separated-facilities";

/** 居酒屋ウエチャベ（道玄坂2-9-2）の代表座標 */
const UECHABE_COORDINATES = { lat: 35.65692, lng: 139.69855 };
const SHIBUYA_CENTER = { lat: 35.658517, lng: 139.701334 };

describe("決定的データ: 渋谷 fixture", () => {
  test("道玄坂方面(ウエチャベ)は西口または桜丘口側の出口が選ばれる", () => {
    const result = resolveExitRecommendation(
      SHIBUYA_DECISIVE_FACILITIES,
      UECHABE_COORDINATES,
      SHIBUYA_CENTER
    );
    expect(result.tier).toBe("exact");
    expect(result.exit).not.toBeNull();
    const gate = pickGateForExit(SHIBUYA_DECISIVE_FACILITIES, result.exit);
    expect(gate).not.toBeNull();
    const exitName = result.exit!.name;
    expect(["西口", "桜丘口"]).toContain(exitName);
    expect(gate!.name.length).toBeGreaterThan(0);
  });

  test("宮益坂方面の目的地では宮益坂口が選ばれる", () => {
    const miyamasuzakaDest = { lat: 35.6612, lng: 139.7035 };
    const result = resolveExitRecommendation(
      SHIBUYA_DECISIVE_FACILITIES,
      miyamasuzakaDest,
      SHIBUYA_CENTER
    );
    expect(result.tier).toBe("exact");
    expect(result.exit?.name).toBe("宮益坂口");
    expect(pickGateForExit(SHIBUYA_DECISIVE_FACILITIES, result.exit)?.name).toBe("宮益坂改札");
  });

  test("決定的データは legacy 複数ペアより優先される", async () => {
    const merged = await mergeSeparatedFacilityPair(
      {
        gateCandidates: [],
        exitCandidates: [],
        legacyPairs: [
          {
            gate: { name: "宮益坂改札", confidenceLevel: "medium" },
            exit: { name: "宮益坂口", confidenceLevel: "medium" },
            reason: null,
          },
          {
            gate: { name: "ヒカリエ改札", confidenceLevel: "medium" },
            exit: { name: "B5出口", confidenceLevel: "medium" },
            reason: null,
          },
        ],
      },
      {
        stationId: "st_shibuya",
        arrivalStationName: "渋谷駅",
        arrivalStationCoordinates: SHIBUYA_CENTER,
        destinationCoordinates: UECHABE_COORDINATES,
      }
    );
    expect(merged?.source).toBe("decisive");
    expect(["西口", "桜丘口"]).toContain(merged?.pair.exit?.name ?? "");
  });
});
