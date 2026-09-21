import { describe, expect, test } from "vitest";
import { buildGoogleMapsUrl } from "@/lib/services/google-maps-url";

describe("buildGoogleMapsUrl", () => {
  test("Place ID があれば店名検索 + query_place_id にする", () => {
    const url = buildGoogleMapsUrl({
      name: "GINZA春秋 首都横浜店",
      placeId: "ChIJ_testPlace",
      coordinates: { lat: 35.4657, lng: 139.622 },
    });
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent("GINZA春秋 首都横浜店") +
        "&query_place_id=ChIJ_testPlace"
    );
    expect(url).not.toContain("35.4657");
    expect(url).not.toContain("destination=");
  });

  test("places/ 接頭辞は Place ID から外す", () => {
    const url = buildGoogleMapsUrl({
      name: "テスト店",
      placeId: "places/ChIJ_abc",
    });
    expect(url).toContain("query_place_id=ChIJ_abc");
    expect(url).not.toContain("places%2F");
  });

  test("店名だけで Place ID が無いときは店名検索にする", () => {
    const url = buildGoogleMapsUrl({
      name: "GINZA春秋 首都横浜店",
      coordinates: { lat: 35.4657, lng: 139.622 },
    });
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent("GINZA春秋 首都横浜店")
    );
    expect(url).not.toContain("35.4657");
  });

  test("店名も Place ID も無いときだけ座標の Directions にする", () => {
    const url = buildGoogleMapsUrl({
      coordinates: { lat: 35.4657, lng: 139.622 },
    });
    expect(url).toBe("https://www.google.com/maps/dir/?api=1&destination=35.4657,139.622");
    expect(url).not.toContain("origin=");
  });

  test("何も無ければ null", () => {
    expect(buildGoogleMapsUrl({})).toBeNull();
    expect(buildGoogleMapsUrl({ name: "  " })).toBeNull();
  });
});
