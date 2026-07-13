import { afterEach, describe, expect, test, vi } from "vitest";
import { GooglePlaceAdapter } from "../GooglePlaceAdapter";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function buildStationProvider(): StationProviderPort {
  return {
    async searchStations() {
      return [];
    },
    async getStation() {
      return null;
    },
    async getPlatforms() {
      return [];
    },
    async getFacilities() {
      return [];
    },
    async getBoardingPosition() {
      return null;
    },
    async nearestStations() {
      return [];
    },
  };
}

describe("GooglePlaceAdapter.searchPlaces", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("near を渡すと Google Places Text Search に locationBias を含めて送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    await adapter.searchPlaces("スターバックス", { lat: 35.4436, lng: 139.585 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.locationBias).toEqual({
      circle: {
        center: { latitude: 35.4436, longitude: 139.585 },
        radius: 30000,
      },
    });
  });

  test("near を渡さない場合は locationBias を含めない(従来通り全国検索)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    await adapter.searchPlaces("スターバックス");

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.locationBias).toBeUndefined();
  });

  test("near が null の場合も locationBias を含めない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    await adapter.searchPlaces("スターバックス", null);

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.locationBias).toBeUndefined();
  });
});

describe("GooglePlaceAdapter.getPlace", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("languageCode=ja をクエリパラメータで指定する(未指定だとGoogle既定言語=英語名が返るため)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "place_1",
        displayName: { text: "とんかつ とんき 目黒本店", languageCode: "ja" },
        formattedAddress: "東京都目黒区下目黒1-1-2",
        location: { latitude: 35.6336, longitude: 139.7143 },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const result = await adapter.getPlace("place_1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    const parsedUrl = new URL(url as string);
    expect(parsedUrl.searchParams.get("languageCode")).toBe("ja");
    expect(parsedUrl.searchParams.get("regionCode")).toBe("JP");
    expect(result?.name).toBe("とんかつ とんき 目黒本店");
  });
});
