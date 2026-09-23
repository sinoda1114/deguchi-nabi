import type { Confidence } from "@/lib/domain/confidence";
import type { Coordinates, StationFacility } from "@/lib/domain/station";

export const OSM_TIMEOUT_MS = 8_000;
export const OSM_AROUND_METERS = 400;
export const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

export interface OsmExit {
  osmId: string;
  name: string;
  coordinates: Coordinates;
}

const OSM_CONFIDENCE: Confidence = {
  level: "medium",
  reasons: ["OpenStreetMap の subway_entrance(地図推定)"],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 1,
};

export function buildSubwayEntranceQuery(center: Coordinates): string {
  return `[out:json][timeout:6];
(
  node(around:${OSM_AROUND_METERS},${center.lat},${center.lng})[railway=subway_entrance];
  node(around:${OSM_AROUND_METERS},${center.lat},${center.lng})[railway=train_station_entrance];
);
out body;`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseOverpassExits(payload: unknown): OsmExit[] {
  if (!isRecord(payload) || !Array.isArray(payload.elements)) return [];
  const exits: OsmExit[] = [];
  for (const element of payload.elements) {
    if (!isRecord(element)) continue;
    if (element.type !== "node") continue;
    const lat = element.lat;
    const lon = element.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const tags = isRecord(element.tags) ? element.tags : {};
    const rawName =
      (typeof tags.name === "string" && tags.name.trim()) ||
      (typeof tags.ref === "string" && tags.ref.trim()) ||
      "";
    if (rawName.length === 0 || rawName.length > 100) continue;
    const id = typeof element.id === "number" ? String(element.id) : rawName;
    exits.push({
      osmId: `osm_${id}`,
      name: rawName.includes("出口") || rawName.includes("口") ? rawName : `${rawName}出口`,
      coordinates: { lat, lng: lon },
    });
  }
  return exits;
}

export async function fetchOsmSubwayEntrances(center: Coordinates): Promise<OsmExit[]> {
  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: buildSubwayEntranceQuery(center) }),
      signal: AbortSignal.timeout(OSM_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    return parseOverpassExits(await response.json());
  } catch {
    return [];
  }
}

export function osmExitsToFacilities(exits: OsmExit[], stationId: string): StationFacility[] {
  return exits.map((exit) => ({
    facilityId: exit.osmId,
    stationId,
    facilityType: "exit" as const,
    name: exit.name,
    level: "地上",
    accessible: true,
    coordinates: exit.coordinates,
    connectedGateId: null,
    confidence: OSM_CONFIDENCE,
    verifiedAt: null,
    provenance: "map_estimate" as const,
  }));
}

function normalizeExitName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/**
 * カタログ出口と OSM 出口をマージする。
 * 同名はカタログ(明示リンクあり)を優先。未知の OSM 出口は connectedGateId 無しで追加する
 * (近さだけで改札を推定しない)。
 */
export function mergeOsmExitsIntoCatalog(
  catalogFacilities: StationFacility[],
  osmExits: OsmExit[]
): StationFacility[] {
  const merged = [...catalogFacilities];
  const existingNames = new Set(
    catalogFacilities
      .filter((f) => f.facilityType === "exit")
      .map((f) => normalizeExitName(f.name))
  );
  const stationId = catalogFacilities[0]?.stationId ?? "osm";
  for (const osmFacility of osmExitsToFacilities(osmExits, stationId)) {
    if (existingNames.has(normalizeExitName(osmFacility.name))) continue;
    existingNames.add(normalizeExitName(osmFacility.name));
    merged.push(osmFacility);
  }
  return merged;
}
