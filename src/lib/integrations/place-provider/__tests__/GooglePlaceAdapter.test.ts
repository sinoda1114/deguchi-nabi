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

  test("Place Details の X-Goog-FieldMask に businessStatus と websiteUri を含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "place_1",
        displayName: { text: "テスト施設" },
        formattedAddress: "テスト住所",
        location: { latitude: 35.0, longitude: 139.0 },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    await adapter.getPlace("place_1");

    const [, options] = fetchMock.mock.calls[0];
    const fieldMask = (options as RequestInit).headers as Record<string, string>;
    expect(fieldMask["X-Goog-FieldMask"]).toContain("businessStatus");
    expect(fieldMask["X-Goog-FieldMask"]).toContain("websiteUri");
  });

  test("websiteUri を Destination.websiteUri にそのまま反映する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "place_1",
        displayName: { text: "テスト施設" },
        formattedAddress: "テスト住所",
        location: { latitude: 35.0, longitude: 139.0 },
        websiteUri: "https://example.com/",
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const result = await adapter.getPlace("place_1");

    expect(result?.websiteUri).toBe("https://example.com/");
  });

  test("websiteUri が無い場合は null を返す(未確認ではなく確認済みで無しと区別する)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "place_1",
        displayName: { text: "テスト施設" },
        formattedAddress: "テスト住所",
        location: { latitude: 35.0, longitude: 139.0 },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const result = await adapter.getPlace("place_1");

    expect(result?.websiteUri).toBeNull();
  });

  test("businessStatus が OPERATIONAL の場合は operational を返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "place_1",
        displayName: { text: "テスト施設" },
        formattedAddress: "テスト住所",
        location: { latitude: 35.0, longitude: 139.0 },
        businessStatus: "OPERATIONAL",
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const result = await adapter.getPlace("place_1");

    expect(result?.businessStatus).toBe("operational");
  });

  test("businessStatus が CLOSED_TEMPORARILY の場合は除外せず closed_temporarily を付与する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "place_1",
        displayName: { text: "テスト施設" },
        formattedAddress: "テスト住所",
        location: { latitude: 35.0, longitude: 139.0 },
        businessStatus: "CLOSED_TEMPORARILY",
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const result = await adapter.getPlace("place_1");

    expect(result).not.toBeNull();
    expect(result?.businessStatus).toBe("closed_temporarily");
  });

  test("businessStatus が CLOSED_PERMANENTLY の場合は null を返す(閉店店舗は目的地にしない)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "place_1",
        displayName: { text: "閉店した店" },
        formattedAddress: "テスト住所",
        location: { latitude: 35.0, longitude: 139.0 },
        businessStatus: "CLOSED_PERMANENTLY",
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const result = await adapter.getPlace("place_1");

    expect(result).toBeNull();
  });

  test("businessStatus が無い場合(施設種別が対象外等)は businessStatus フィールドを付与しない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "place_1",
        displayName: { text: "テスト住所地点" },
        formattedAddress: "テスト住所",
        location: { latitude: 35.0, longitude: 139.0 },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const result = await adapter.getPlace("place_1");

    expect(result?.businessStatus).toBeUndefined();
  });
});

describe("GooglePlaceAdapter.searchPlaces フィールドマスク", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("Text Search の X-Goog-FieldMask に places.businessStatus と places.websiteUri を含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    await adapter.searchPlaces("スターバックス");

    const [, options] = fetchMock.mock.calls[0];
    const fieldMask = (options as RequestInit).headers as Record<string, string>;
    expect(fieldMask["X-Goog-FieldMask"]).toContain("places.businessStatus");
    expect(fieldMask["X-Goog-FieldMask"]).toContain("places.websiteUri");
  });
});

describe("GooglePlaceAdapter.searchPlaces 閉店店舗の除外", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("CLOSED_PERMANENTLY の候補は検索結果から除外する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        places: [
          {
            id: "place_open",
            displayName: { text: "営業中の店" },
            formattedAddress: "住所A",
            location: { latitude: 35.0, longitude: 139.0 },
            businessStatus: "OPERATIONAL",
          },
          {
            id: "place_closed",
            displayName: { text: "閉店した店" },
            formattedAddress: "住所B",
            location: { latitude: 35.0, longitude: 139.0 },
            businessStatus: "CLOSED_PERMANENTLY",
          },
        ],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const results = await adapter.searchPlaces("テスト");

    expect(results.map((r) => r.destinationId)).toEqual(["place_open"]);
  });

  test("CLOSED_TEMPORARILY の候補は除外せず closed_temporarily を付与して残す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        places: [
          {
            id: "place_temp_closed",
            displayName: { text: "一時休業中の店" },
            formattedAddress: "住所A",
            location: { latitude: 35.0, longitude: 139.0 },
            businessStatus: "CLOSED_TEMPORARILY",
          },
        ],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const results = await adapter.searchPlaces("テスト");

    expect(results).toHaveLength(1);
    expect(results[0].businessStatus).toBe("closed_temporarily");
  });
});

describe("GooglePlaceAdapter.searchPlaces 同名店舗の距離フィルタ", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("near から大きく離れた同名店舗は候補から除外する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        places: [
          {
            id: "place_near",
            displayName: { text: "スターバックス 近所店" },
            formattedAddress: "近所の住所",
            // near(35.4436, 139.585)から約1km
            location: { latitude: 35.45, longitude: 139.585 },
          },
          {
            id: "place_far",
            displayName: { text: "スターバックス 遠方店" },
            formattedAddress: "遠方の住所",
            // near から約1000km以上離れた地点(福岡付近)
            location: { latitude: 33.5904, longitude: 130.4017 },
          },
        ],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const results = await adapter.searchPlaces("スターバックス", { lat: 35.4436, lng: 139.585 });

    expect(results.map((r) => r.destinationId)).toEqual(["place_near"]);
  });

  test("near を渡さない場合は距離フィルタを適用しない(従来通り全国検索)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        places: [
          {
            id: "place_far",
            displayName: { text: "スターバックス 遠方店" },
            formattedAddress: "遠方の住所",
            location: { latitude: 33.5904, longitude: 130.4017 },
          },
        ],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const results = await adapter.searchPlaces("スターバックス");

    expect(results.map((r) => r.destinationId)).toEqual(["place_far"]);
  });

  test("位置情報が無い候補は距離判定できないため除外しない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        places: [
          {
            id: "place_no_location",
            displayName: { text: "座標不明の店" },
            formattedAddress: "住所不明",
          },
        ],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const adapter = new GooglePlaceAdapter("test-key", buildStationProvider());

    const results = await adapter.searchPlaces("テスト", { lat: 35.4436, lng: 139.585 });

    expect(results.map((r) => r.destinationId)).toEqual(["place_no_location"]);
  });
});
