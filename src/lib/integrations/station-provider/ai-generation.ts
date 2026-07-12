import { randomUUID } from "node:crypto";
import type { BoardingPosition, FacilityType, StationFacility } from "@/lib/domain/station";
import { generateStructuredContent } from "@/lib/integrations/ai/GeminiClient";

const AI_GENERATED_REASON = "AIによる推測情報。現地未確認のため参考程度に扱ってください。";
const MAX_CAR_NUMBER = 16;
const MAX_TEXT_LENGTH = 200;

function aiConfidence() {
  return {
    level: "low" as const,
    reasons: [AI_GENERATED_REASON],
    verifiedAt: null,
    expiresAt: null,
    sourceCount: 0,
  };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

interface GeneratedFacility {
  facilityType: FacilityType;
  name: string;
  level: string;
}

const VALID_FACILITY_TYPES: FacilityType[] = [
  "stairs",
  "escalator",
  "elevator",
  "gate",
  "exit",
  "passage",
];

function isValidFacility(f: unknown): f is GeneratedFacility {
  if (typeof f !== "object" || f === null) return false;
  const candidate = f as Record<string, unknown>;
  return (
    typeof candidate.facilityType === "string" &&
    VALID_FACILITY_TYPES.includes(candidate.facilityType as FacilityType) &&
    isNonEmptyText(candidate.name) &&
    isNonEmptyText(candidate.level)
  );
}

const FACILITIES_SCHEMA = {
  type: "object",
  properties: {
    facilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          facilityType: {
            type: "string",
            enum: VALID_FACILITY_TYPES,
          },
          name: { type: "string" },
          level: { type: "string" },
        },
        required: ["facilityType", "name", "level"],
      },
    },
  },
  required: ["facilities"],
};

export async function generateStationFacilities(
  apiKey: string,
  stationName: string,
  operator: string,
  lines: string[]
): Promise<StationFacility[]> {
  const prompt = `${stationName}(${operator}、${lines.join("・")})の主要な改札名・出口名・エスカレーター/エレベーターの位置について、一般的に知られている情報のみを教えてください。
確信が持てないものは含めず、広く知られている代表的なもの数件に絞ってください。存在しない情報を創作しないでください。
JSON形式で回答してください。`;

  const result = await generateStructuredContent<{ facilities: GeneratedFacility[] }>(
    apiKey,
    prompt,
    FACILITIES_SCHEMA
  );

  if (!result?.facilities) return [];

  return result.facilities.filter(isValidFacility).map((f) => ({
    facilityId: randomUUID(),
    stationId: "",
    facilityType: f.facilityType,
    name: f.name,
    level: f.level,
    accessible: f.facilityType === "elevator",
    coordinates: null,
    confidence: aiConfidence(),
    verifiedAt: null,
  }));
}

interface GeneratedBoardingPosition {
  carNumber: number;
  doorPosition: "前方" | "中央" | "後方";
  reason: string;
}

const VALID_DOOR_POSITIONS = ["前方", "中央", "後方"];

function isValidBoardingPosition(value: unknown): value is GeneratedBoardingPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.carNumber === "number" &&
    Number.isInteger(candidate.carNumber) &&
    candidate.carNumber >= 1 &&
    candidate.carNumber <= MAX_CAR_NUMBER &&
    typeof candidate.doorPosition === "string" &&
    VALID_DOOR_POSITIONS.includes(candidate.doorPosition) &&
    isNonEmptyText(candidate.reason)
  );
}

const BOARDING_SCHEMA = {
  type: "object",
  properties: {
    carNumber: { type: "integer" },
    doorPosition: { type: "string", enum: VALID_DOOR_POSITIONS },
    reason: { type: "string" },
  },
  required: ["carNumber", "doorPosition", "reason"],
};

export async function generateBoardingPosition(
  apiKey: string,
  stationName: string,
  line: string,
  direction: string,
  platformId: string
): Promise<BoardingPosition | null> {
  const prompt = `${stationName}から${direction}へ向かう${line}で、乗換や出口に近い乗車位置(号車・ドア位置)について、
一般的に知られている情報があれば教えてください。確信が持てない場合は無理に答えず、最も一般的に言われている情報のみ回答してください。
JSON形式で回答してください。`;

  const result = await generateStructuredContent<GeneratedBoardingPosition>(
    apiKey,
    prompt,
    BOARDING_SCHEMA
  );

  if (!isValidBoardingPosition(result)) return null;

  return {
    boardingPositionId: randomUUID(),
    platformId,
    trainFormation: 0,
    carNumber: result.carNumber,
    doorPosition: result.doorPosition,
    targetFacilityId: null,
    reason: result.reason,
    confidence: aiConfidence(),
    verifiedAt: null,
  };
}
