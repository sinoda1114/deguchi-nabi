import { describe, expect, test } from "vitest";
import {
  catalogStationNameFrom,
  lookupCatalogStation,
  normalizeStationName,
} from "@/lib/data/station-facility-catalog";
import {
  catalogChosenGateNameFromStation,
  catalogChosenGateNameOf,
  resolveFacilityFromCatalog,
} from "@/lib/services/catalog-facility-resolver";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import {
  SHIBUYA_EAST_REJECT,
  SHIBUYA_WEST_ALLOWLIST,
  UECHABE_DOGENZAKA,
} from "@/lib/eval/exit-quality-gate";

describe("station-facility-catalog", () => {
  test("駅名の正規化は末尾の駅を除き HeartRails クラスタを同一視する", () => {
    expect(normalizeStationName("渋谷駅")).toBe("渋谷");
    expect(normalizeStationName("渋谷")).toBe("渋谷");
    expect(catalogStationNameFrom({ stationName: "渋谷駅", stationId: "hr_ignored" })).toBe("渋谷");
    expect(lookupCatalogStation("渋谷駅")?.keys).toContain("渋谷");
  });
});

describe("resolveFacilityFromCatalog 西谷→ウエチャベ", () => {
  test("道玄坂2-9-2 は西側の改札と出口の両方を confirmed にする", () => {
    const rec = resolveFacilityFromCatalog({
      stationName: "渋谷駅",
      stationCoordinates: { lat: 35.65861, lng: 139.70111 },
      destinationCoordinates: UECHABE_DOGENZAKA.coordinates,
    }).recommendation;

    expect(isScoringBothHit(rec)).toBe(true);
    expect(rec.state).toBe("confirmed");
    if (rec.state !== "confirmed") return;
    expect(SHIBUYA_WEST_ALLOWLIST.gates).toContain(rec.pair.gate!.name);
    expect(SHIBUYA_WEST_ALLOWLIST.exits).toContain(rec.pair.exit!.name);
    expect(SHIBUYA_EAST_REJECT).not.toContain(rec.pair.gate!.name);
    expect(SHIBUYA_EAST_REJECT).not.toContain(rec.pair.exit!.name);
    expect(rec.pair.exit!.name).toBe("A1出口");
    expect(rec.pair.gate!.name).toBe("道玄坂改札");
  });

  test("東側の目的地ではヒカリエ/宮益坂側を選び道玄坂を選ばない", () => {
    const rec = resolveFacilityFromCatalog({
      stationName: "渋谷駅",
      stationCoordinates: { lat: 35.65861, lng: 139.70111 },
      destinationCoordinates: { lat: 35.6582, lng: 139.7048 },
    }).recommendation;

    expect(isScoringBothHit(rec)).toBe(true);
    if (rec.state !== "confirmed") return;
    expect(rec.pair.exit?.name === "B5出口" || rec.pair.exit?.name === "宮益坂口").toBe(true);
    expect(rec.pair.exit?.name).not.toBe("A1出口");
  });

  test("目的地座標が無いときは断定せず BothHit にしない", () => {
    const rec = resolveFacilityFromCatalog({
      stationName: "渋谷駅",
      stationCoordinates: { lat: 35.65861, lng: 139.70111 },
      destinationCoordinates: null,
    }).recommendation;
    expect(isScoringBothHit(rec)).toBe(false);
    expect(rec.state).toBe("unavailable");
  });

  test("catalogChosenGateNameOf はウエチャベで道玄坂改札を返す", () => {
    expect(
      catalogChosenGateNameOf({
        stationName: "渋谷駅",
        stationCoordinates: { lat: 35.65861, lng: 139.70111 },
        destinationCoordinates: UECHABE_DOGENZAKA.coordinates,
      })
    ).toBe("道玄坂改札");
  });

  test("catalogChosenGateNameFromStation は座標が無いと null", () => {
    expect(
      catalogChosenGateNameFromStation(
        {
          stationId: "hr_shibuya",
          stationName: "渋谷駅",
          operator: "東急電鉄",
          lines: ["東急東横線"],
          prefecture: "東京都",
          latitude: 35.65861,
          longitude: 139.70111,
        },
        null
      )
    ).toBeNull();
  });

  test("catalogChosenGateNameOf は収録の無い駅では null", () => {
    expect(
      catalogChosenGateNameOf({
        stationName: "横浜駅",
        stationCoordinates: { lat: 35.466, lng: 139.622 },
        destinationCoordinates: { lat: 35.465, lng: 139.622 },
      })
    ).toBeNull();
  });

  test("収録の無い駅は unavailable", () => {
    const rec = resolveFacilityFromCatalog({
      stationName: "横浜駅",
      stationCoordinates: { lat: 35.466, lng: 139.622 },
      destinationCoordinates: { lat: 35.465, lng: 139.622 },
    }).recommendation;
    expect(rec.state).toBe("unavailable");
    expect(isScoringBothHit(rec)).toBe(false);
  });
});
