import type { Confidence } from "./confidence";
import type { FacilityType } from "./station";

export type RouteMode = "fastest" | "easy" | "accessible";

export const ROUTE_MODE_LABEL: Record<RouteMode, string> = {
  fastest: "最短",
  easy: "迷わない",
  accessible: "バリアフリー",
};

export type RouteSegmentType = "train" | "transfer" | "station_walk" | "exit";

export interface RouteSegmentFacility {
  facilityType: FacilityType;
  name: string;
  confidence: Confidence;
}

export interface RouteSegment {
  type: RouteSegmentType;
  from: string;
  to: string;
  line: string | null;
  direction: string | null;
  platform: string | null;
  boardingPosition: {
    carNumber: number;
    doorPosition: string;
    reason: string;
  } | null;
  facilities: RouteSegmentFacility[];
  instruction: string;
  confidence: Confidence;
  sourceReferences: string[];
  warnings: string[];
}

export interface RouteSummary {
  originName: string;
  destinationName: string;
  arrivalStationName: string;
  recommendedExit: string;
  estimatedDurationMinutes: number | null;
  transferCount: number;
  walkingDistanceMeters: number | null;
}

export interface RouteConfidenceSummary {
  boardingPosition: Confidence["level"];
  transferGuide: Confidence["level"];
  gate: Confidence["level"];
  exit: Confidence["level"];
  accessibility: Confidence["level"] | null;
}

export interface KeyInstruction {
  text: string;
}

export interface RouteGuide {
  routeId: string;
  mode: RouteMode;
  summary: RouteSummary;
  keyInstruction: KeyInstruction;
  segments: RouteSegment[];
  confidenceSummary: RouteConfidenceSummary;
  warnings: string[];
  generatedAt: string;
  expiresAt: string;
}

export interface AccessibilityCondition {
  avoidStairs: boolean;
  preferElevator: boolean;
  preferEscalator: boolean;
}

export type OriginInput =
  | { type: "home_station" }
  | { type: "current_location"; latitude: number; longitude: number }
  | { type: "station"; stationId: string };

export type DestinationInput =
  | { type: "station"; stationId: string }
  | { type: "place"; placeId: string };

export interface RouteSearchRequest {
  origin: OriginInput;
  destination: DestinationInput;
  mode: RouteMode;
  accessibility: AccessibilityCondition;
}
