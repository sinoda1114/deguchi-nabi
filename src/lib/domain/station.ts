import type { Confidence } from "./confidence";

export interface Station {
  stationId: string;
  stationName: string;
  operator: string;
  lines: string[];
  prefecture: string;
  latitude: number;
  longitude: number;
}

export interface Platform {
  platformId: string;
  stationId: string;
  lineId: string;
  direction: string;
  platformNumber: string;
}

export interface BoardingPosition {
  boardingPositionId: string;
  platformId: string;
  trainFormation: number;
  carNumber: number;
  doorPosition: "前方" | "中央" | "後方";
  targetFacilityId: string | null;
  reason: string;
  confidence: Confidence;
  verifiedAt: string | null;
}

export type FacilityType =
  | "stairs"
  | "escalator"
  | "elevator"
  | "gate"
  | "exit"
  | "passage";

export interface StationFacility {
  facilityId: string;
  stationId: string;
  facilityType: FacilityType;
  name: string;
  level: string;
  accessible: boolean;
  coordinates: { lat: number; lng: number } | null;
  /**
   * facilityType === "exit" の場合のみ意味を持つ、接続先の改札(gate) facilityId。
   * 座標の近さだけで出口↔改札の連結を推定すると、物理的に近くても実際には
   * 連絡していない改札を誤って選んでしまうため、明示的なリンクとして持たせる
   * (docs/04_EXIT_SELECTION_DESIGN.md 参照)。
   */
  connectedGateId: string | null;
  confidence: Confidence;
  verifiedAt: string | null;
}

export interface Destination {
  destinationId: string;
  name: string;
  category: "station" | "facility" | "shop" | "address";
  address: string;
  latitude: number;
  longitude: number;
  nearestStationCandidates: string[];
}
