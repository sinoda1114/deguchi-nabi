import { describe, expect, test } from "vitest";
import { resolveOriginDestination } from "@/lib/services/route-search-orchestrator";
import type { OriginDestinationDeps } from "@/lib/services/route-search-orchestrator";
import type { PlaceProviderPort } from "@/lib/integrations/place-provider/PlaceProviderPort";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import type { BoardingPosition, Destination, Station } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";

const STATIONS: Record<string, Station> = {
  origin: {
    stationId: "origin",
    stationName: "出発駅",
    operator: "テスト鉄道",
    lines: ["テスト線"],
    prefecture: "東京都",
    latitude: 0,
    longitude: 0,
  },
  destination: {
    stationId: "destination",
    stationName: "到着駅",
    operator: "テスト鉄道",
    lines: ["テスト線"],
    prefecture: "東京都",
    latitude: 0,
    longitude: 0,
  },
};

function buildStationProvider(): StationProviderPort {
  return {
    async searchStations() {
      return Object.values(STATIONS);
    },
    async getStation(stationId: string) {
      return STATIONS[stationId] ?? null;
    },
    async getPlatforms() {
      return [];
    },
    async getFacilities() {
      return [];
    },
    async getBoardingPosition(): Promise<BoardingPosition | null> {
      return null;
    },
    async nearestStations() {
      return Object.values(STATIONS);
    },
  };
}

const PLACE: Destination = {
  destinationId: "place_1",
  name: "テスト目的地",
  category: "facility",
  address: "テスト住所",
  latitude: 0,
  longitude: 0,
  nearestStationCandidates: ["destination"],
};

function buildPlaceProvider(place: Destination | null): PlaceProviderPort {
  return {
    async searchPlaces() {
      return place ? [place] : [];
    },
    async getPlace() {
      return place;
    },
  };
}

const BASE_USER: User = {
  userId: "user_1",
  email: "user@example.com",
  displayName: "テストユーザー",
  homeStationId: "origin",
  plan: "free",
  locale: "ja",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("resolveOriginDestination", () => {
  test("home_station 指定時に sessionUser.homeStationId が未登録なら ok:false(400) を返す", async () => {
    const deps: OriginDestinationDeps = {
      stationProvider: buildStationProvider(),
      placeProvider: buildPlaceProvider(PLACE),
    };
    const result = await resolveOriginDestination(
      {
        origin: { type: "home_station" },
        destination: { type: "station", stationId: "destination" },
      },
      { ...BASE_USER, homeStationId: null },
      deps
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("home_station 指定時に sessionUser.homeStationId があれば出発地として解決する", async () => {
    const deps: OriginDestinationDeps = {
      stationProvider: buildStationProvider(),
      placeProvider: buildPlaceProvider(PLACE),
    };
    const result = await resolveOriginDestination(
      {
        origin: { type: "home_station" },
        destination: { type: "station", stationId: "destination" },
      },
      BASE_USER,
      deps
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.originStationId).toBe("origin");
    expect(result.originLabel).toBe("出発駅");
  });

  test("destination が station で見つからない場合は ok:false(404) を返す", async () => {
    const deps: OriginDestinationDeps = {
      stationProvider: buildStationProvider(),
      placeProvider: buildPlaceProvider(PLACE),
    };
    const result = await resolveOriginDestination(
      {
        origin: { type: "station", stationId: "origin" },
        destination: { type: "station", stationId: "unknown" },
      },
      null,
      deps
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  test("destination が place で見つからない場合は ok:false(404) を返す", async () => {
    const deps: OriginDestinationDeps = {
      stationProvider: buildStationProvider(),
      placeProvider: buildPlaceProvider(null),
    };
    const result = await resolveOriginDestination(
      {
        origin: { type: "station", stationId: "origin" },
        destination: { type: "place", placeId: "unknown" },
      },
      null,
      deps
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  test("place の最寄り駅候補が空の場合は ok:false(400) を返す", async () => {
    const deps: OriginDestinationDeps = {
      stationProvider: buildStationProvider(),
      placeProvider: buildPlaceProvider({ ...PLACE, nearestStationCandidates: [] }),
    };
    const result = await resolveOriginDestination(
      {
        origin: { type: "station", stationId: "origin" },
        destination: { type: "place", placeId: "place_1" },
      },
      null,
      deps
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("station 指定同士で正常に origin/destination を解決する", async () => {
    const deps: OriginDestinationDeps = {
      stationProvider: buildStationProvider(),
      placeProvider: buildPlaceProvider(PLACE),
    };
    const result = await resolveOriginDestination(
      {
        origin: { type: "station", stationId: "origin" },
        destination: { type: "station", stationId: "destination" },
      },
      null,
      deps
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.originStationId).toBe("origin");
    expect(result.originLabel).toBe("出発駅");
    expect(result.destinationStationId).toBe("destination");
    expect(result.destinationLabel).toBe("到着駅");
  });

  test("place 指定の目的地は最寄り駅候補の先頭を destinationStationId とし、place 名を destinationLabel とする", async () => {
    const deps: OriginDestinationDeps = {
      stationProvider: buildStationProvider(),
      placeProvider: buildPlaceProvider(PLACE),
    };
    const result = await resolveOriginDestination(
      {
        origin: { type: "station", stationId: "origin" },
        destination: { type: "place", placeId: "place_1" },
      },
      null,
      deps
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.destinationStationId).toBe("destination");
    expect(result.destinationLabel).toBe("テスト目的地");
  });
});
