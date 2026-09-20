import { describe, expect, test } from "vitest";
import {
  mergeOsmExitsIntoCatalog,
  parseOverpassExits,
} from "@/lib/integrations/osm/osm-subway-entrances";
import { lookupCatalogStation } from "@/lib/data/station-facility-catalog";

describe("parseOverpassExits", () => {
  test("name/ref 付きの subway_entrance だけを拾う", () => {
    const exits = parseOverpassExits({
      elements: [
        { type: "node", id: 1, lat: 35.658, lon: 139.6984, tags: { name: "A0" } },
        { type: "node", id: 2, lat: 35.65, lon: 139.7, tags: {} },
        { type: "way", id: 3, tags: { name: "無視" } },
      ],
    });
    expect(exits).toEqual([
      { osmId: "osm_1", name: "A0出口", coordinates: { lat: 35.658, lng: 139.6984 } },
    ]);
  });

  test("壊れた JSON は空配列(fail-open)", () => {
    expect(parseOverpassExits(null)).toEqual([]);
    expect(parseOverpassExits({ elements: "nope" })).toEqual([]);
  });
});

describe("mergeOsmExitsIntoCatalog", () => {
  test("同名の OSM 出口はカタログ(接続改札あり)を残す", () => {
    const catalog = [...(lookupCatalogStation("渋谷")?.facilities ?? [])];
    const merged = mergeOsmExitsIntoCatalog(catalog, [
      { osmId: "osm_dup", name: "A1出口", coordinates: { lat: 1, lng: 1 } },
      { osmId: "osm_new", name: "A0出口", coordinates: { lat: 35.6581, lng: 139.698 } },
    ]);
    const a1 = merged.filter((f) => f.name === "A1出口");
    expect(a1).toHaveLength(1);
    expect(a1[0].connectedGateId).toBe("cat_shibuya_dogenzaka_gate");
    expect(merged.some((f) => f.name === "A0出口" && f.connectedGateId === null)).toBe(true);
  });
});
