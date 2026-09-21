import type { Confidence } from "@/lib/domain/confidence";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { decodeHeartRailsStationId } from "@/lib/integrations/station-provider/heartrails";

const CATALOG_STATION_ID = "cat_shibuya";
const SURVEYED_AT = "2026-09-20";

function surveyedConfidence(reason: string): Confidence {
  return {
    level: "high",
    reasons: [reason],
    verifiedAt: SURVEYED_AT,
    expiresAt: null,
    sourceCount: 1,
  };
}

function catalogFacility(
  facilityId: string,
  facilityType: "gate" | "exit",
  name: string,
  coordinates: Coordinates,
  connectedGateId: string | null
): StationFacility {
  return {
    facilityId,
    stationId: CATALOG_STATION_ID,
    facilityType,
    name,
    level: facilityType === "gate" ? "改札階" : "地上",
    accessible: true,
    coordinates,
    connectedGateId,
    confidence: surveyedConfidence("公式構内図・地図で名称と位置を確認した収録データ"),
    verifiedAt: SURVEYED_AT,
    provenance: "surveyed",
  };
}

export interface CatalogStation {
  /** Matching keys after normalizeStationName. Never HeartRails ids. */
  keys: readonly string[];
  stationCenter: Coordinates;
  facilities: readonly StationFacility[];
}

/**
 * Phase 1 の決定的データ。旧 fixture(st_*) の復活ではない。
 * HeartRails の複数クラスタ(hr_渋谷_*)は駅名正規化で同一行に載せる。
 */
export const STATION_FACILITY_CATALOG: readonly CatalogStation[] = [
  {
    keys: ["渋谷"],
    stationCenter: { lat: 35.65861, lng: 139.70111 },
    facilities: [
      catalogFacility(
        "cat_shibuya_dogenzaka_gate",
        "gate",
        "道玄坂改札",
        { lat: 35.6582, lng: 139.6991 },
        null
      ),
      catalogFacility(
        "cat_shibuya_dogenzaka_a1",
        "exit",
        "A1出口",
        { lat: 35.658, lng: 139.6984 },
        "cat_shibuya_dogenzaka_gate"
      ),
      catalogFacility(
        "cat_shibuya_hachiko_gate",
        "gate",
        "ハチ公改札",
        { lat: 35.6588, lng: 139.7007 },
        null
      ),
      catalogFacility(
        "cat_shibuya_hachiko_exit",
        "exit",
        "ハチ公口",
        { lat: 35.65905, lng: 139.70055 },
        "cat_shibuya_hachiko_gate"
      ),
      catalogFacility(
        "cat_shibuya_hikarie_gate",
        "gate",
        "ヒカリエ改札",
        { lat: 35.6583, lng: 139.7034 },
        null
      ),
      catalogFacility(
        "cat_shibuya_hikarie_b5",
        "exit",
        "B5出口",
        { lat: 35.6582, lng: 139.7036 },
        "cat_shibuya_hikarie_gate"
      ),
      catalogFacility(
        "cat_shibuya_miyamasuzaka_gate",
        "gate",
        "宮益坂改札",
        { lat: 35.6591, lng: 139.7025 },
        null
      ),
      catalogFacility(
        "cat_shibuya_miyamasuzaka_exit",
        "exit",
        "宮益坂口",
        { lat: 35.6592, lng: 139.7024 },
        "cat_shibuya_miyamasuzaka_gate"
      ),
    ],
  },
];

export function normalizeStationName(name: string): string {
  const trimmed = name.normalize("NFKC").trim();
  return trimmed.endsWith("駅") ? trimmed.slice(0, -1) : trimmed;
}

export function catalogStationNameFrom(input: {
  stationName: string;
  stationId?: string;
}): string {
  const fromName = input.stationName.trim();
  if (fromName.length > 0) return normalizeStationName(fromName);
  if (!input.stationId) return "";
  const decoded = decodeHeartRailsStationId(input.stationId);
  return decoded ? normalizeStationName(decoded.stationName) : "";
}

export function lookupCatalogStation(stationName: string): CatalogStation | null {
  const key = normalizeStationName(stationName);
  if (key.length === 0) return null;
  return STATION_FACILITY_CATALOG.find((row) => row.keys.includes(key)) ?? null;
}
