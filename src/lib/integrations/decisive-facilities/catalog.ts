import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { SHIBUYA_DECISIVE_FACILITIES } from "./shibuya-fixture";
import { attachSyntheticGatesForOsmExits, fetchOsmExitFacilities } from "./osm-station-exits";

const osmCache = new Map<string, Promise<StationFacility[]>>();

function normalizeStationName(stationName: string): string {
  return stationName.replace(/駅$/, "").trim();
}

function fixtureForStation(stationName: string): StationFacility[] {
  const key = normalizeStationName(stationName);
  if (key === "渋谷") return SHIBUYA_DECISIVE_FACILITIES;
  return [];
}

async function osmFacilitiesForStation(
  stationId: string,
  stationCenter: Coordinates
): Promise<StationFacility[]> {
  const cacheKey = `${stationId}:${stationCenter.lat.toFixed(4)},${stationCenter.lng.toFixed(4)}`;
  let pending = osmCache.get(cacheKey);
  if (!pending) {
    pending = fetchOsmExitFacilities(stationId, stationCenter).then((exits) =>
      attachSyntheticGatesForOsmExits(stationId, exits)
    );
    osmCache.set(cacheKey, pending);
  }
  return pending;
}

/**
 * fixture を優先し、未収録駅は OSM 出入口を補完する決定的カタログ。
 */
export async function loadDecisiveFacilities(
  stationId: string,
  stationName: string,
  stationCenter: Coordinates | null
): Promise<StationFacility[]> {
  const fixture = fixtureForStation(stationName);
  if (fixture.length > 0) return fixture;
  if (!stationCenter) return [];
  const osm = await osmFacilitiesForStation(stationId, stationCenter);
  return osm;
}
