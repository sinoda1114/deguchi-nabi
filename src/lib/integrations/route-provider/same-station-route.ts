import { catalogStationNameFrom } from "@/lib/data/station-facility-catalog";
import type { Station } from "@/lib/domain/station";
import { haversineMeters } from "@/lib/geo/haversine";
import { decodeHeartRailsStationId } from "@/lib/integrations/station-provider/heartrails";

/** 鉄道乗車が不要な同一駅到着（出発駅 ID と目的地最寄り駅 ID が一致）向けの路線ラベル。 */
export const ON_STATION_RAIL_LINE_LABEL = "同一駅（乗車不要）";

/**
 * HeartRails は同一の駅構内でも出入口・路線ごとに別 stationId（駅名表記や
 * 座標クラスタが異なる）を返す。出発駅と目的地最寄り駅が物理的に同じ構内か
 * を判定する。
 */
export const SAME_STATION_MAX_DISTANCE_METERS = 400;

/** 表記ゆれで別 ID になる同一構内駅（正規化後のキー → 代表キー）。 */
const STATION_PLACE_CANONICAL: Readonly<Record<string, string>> = {
  なんば: "難波",
};

function canonicalPlaceKey(station: Station): string {
  const key = catalogStationNameFrom({
    stationName: station.stationName,
    stationId: station.stationId,
  });
  if (key.length === 0) return "";
  return STATION_PLACE_CANONICAL[key] ?? key;
}

function stationForId(stationId: string, station?: Station | null): Station | null {
  if (station) return station;
  return decodeHeartRailsStationId(stationId);
}

function hasUsableCoordinates(station: Station): boolean {
  return (
    Number.isFinite(station.latitude) &&
    Number.isFinite(station.longitude) &&
    !(station.latitude === 0 && station.longitude === 0)
  );
}

function stationsAreSamePhysicalPlace(a: Station, b: Station): boolean {
  const keyA = canonicalPlaceKey(a);
  const keyB = canonicalPlaceKey(b);
  if (keyA.length > 0 && keyA === keyB) return true;

  if (hasUsableCoordinates(a) && hasUsableCoordinates(b)) {
    const distance = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    if (distance <= SAME_STATION_MAX_DISTANCE_METERS) return true;
  }

  return false;
}

export function isSameStationRailRoute(
  originStationId: string,
  destinationStationId: string,
  originStation?: Station | null,
  destinationStation?: Station | null
): boolean {
  if (originStationId.length > 0 && originStationId === destinationStationId) {
    return true;
  }

  const origin = stationForId(originStationId, originStation);
  const destination = stationForId(destinationStationId, destinationStation);
  if (!origin || !destination) return false;

  return stationsAreSamePhysicalPlace(origin, destination);
}
