import { randomUUID } from "node:crypto";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { lowConfidence } from "@/lib/domain/confidence";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_TIMEOUT_MS = 4000;
const SEARCH_RADIUS_METERS = 700;

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function exitNameFromTags(tags: Record<string, string>): string | null {
  const candidates = [
    tags.name,
    tags["name:ja"],
    tags.ref,
    tags["entrance"],
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (candidates.length === 0) return null;
  const name = candidates[0].trim();
  if (name.length > 100) return null;
  return name;
}

/**
 * 駅中心座標周辺の OSM 出入口ノードを StationFacility(exit) に変換する。
 * 失敗時は空配列（呼び出し元は fixture のみにフォールバック）。
 */
export async function fetchOsmExitFacilities(
  stationId: string,
  stationCenter: Coordinates
): Promise<StationFacility[]> {
  const query = `
[out:json][timeout:8];
(
  node["railway"="subway_entrance"](around:${SEARCH_RADIUS_METERS},${stationCenter.lat},${stationCenter.lng});
  node["entrance"](around:${SEARCH_RADIUS_METERS},${stationCenter.lat},${stationCenter.lng});
);
out body;
`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const json = (await response.json()) as OverpassResponse;
    const elements = json.elements ?? [];
    const mapConfidence = lowConfidence("OSM Overpass: 出入口ノード(名称はタグ由来)");

    const facilities: StationFacility[] = [];
    for (const element of elements) {
      if (element.type !== "node" || element.lat === undefined || element.lon === undefined) continue;
      const tags = element.tags ?? {};
      const name = exitNameFromTags(tags);
      if (!name) continue;
      facilities.push({
        facilityId: `osm_exit_${element.id}`,
        stationId,
        facilityType: "exit",
        name,
        level: "地上",
        accessible: tags.wheelchair === "yes",
        coordinates: { lat: element.lat, lng: element.lon },
        connectedGateId: null,
        confidence: mapConfidence,
        verifiedAt: null,
        provenance: "map_estimate",
      });
    }
    return facilities;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** OSM 由来の出口に仮想 gate を1件付与（改札名は出口名ベース。BothHit 用の最低限）。 */
export function attachSyntheticGatesForOsmExits(
  stationId: string,
  exits: StationFacility[]
): StationFacility[] {
  const gates: StationFacility[] = [];
  const linkedExits: StationFacility[] = [];
  for (const exit of exits) {
    const gateId = `osm_gate_${randomUUID()}`;
    gates.push({
      facilityId: gateId,
      stationId,
      facilityType: "gate",
      name: `${exit.name}改札`,
      level: exit.level,
      accessible: exit.accessible,
      coordinates: exit.coordinates,
      connectedGateId: null,
      confidence: exit.confidence,
      verifiedAt: null,
      provenance: "map_estimate",
    });
    linkedExits.push({ ...exit, connectedGateId: gateId });
  }
  return [...gates, ...linkedExits];
}
