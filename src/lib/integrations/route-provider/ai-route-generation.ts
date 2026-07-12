import { searchAndGenerateStructuredContent } from "@/lib/integrations/ai/GeminiClient";
import type { RailRouteCandidate } from "./RouteProviderPort";

const MAX_TRANSFER_COUNT = 10;
const MAX_DURATION_MINUTES = 600;
const MAX_LINE_NAME_LENGTH = 100;

interface GeneratedRoute {
  lines: string[];
  transferCount: number;
  estimatedMinutes: number;
}

const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: { type: "string" },
      description: "乗車順に並べた利用路線名の配列",
    },
    transferCount: { type: "integer" },
    estimatedMinutes: { type: "integer" },
  },
  required: ["lines", "transferCount", "estimatedMinutes"],
};

function isValidGeneratedRoute(value: unknown): value is GeneratedRoute {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.lines) &&
    candidate.lines.length > 0 &&
    candidate.lines.every(
      (l) => typeof l === "string" && l.trim().length > 0 && l.length <= MAX_LINE_NAME_LENGTH
    ) &&
    typeof candidate.transferCount === "number" &&
    Number.isInteger(candidate.transferCount) &&
    candidate.transferCount >= 0 &&
    candidate.transferCount <= MAX_TRANSFER_COUNT &&
    typeof candidate.estimatedMinutes === "number" &&
    Number.isInteger(candidate.estimatedMinutes) &&
    candidate.estimatedMinutes > 0 &&
    candidate.estimatedMinutes <= MAX_DURATION_MINUTES
  );
}

/**
 * fixture に無い駅間の鉄道経路を、Gemini の Google Search Grounding で
 * 検索の裏付けを取った上で生成する。responseSchema と google_search tool は
 * 同時指定すると検索が働かないため、検索→構造化抽出の2段階で呼び出す
 * (GeminiClient.searchAndGenerateStructuredContent 参照)。
 *
 * 号車・ホーム番号までは検索結果から確実に取れないため platformId は
 * 空文字列とし、乗車位置は「確認できません」として扱われる(route-search.ts側)。
 */
export async function generateRailRoute(
  apiKey: string,
  originStationId: string,
  originStationName: string,
  destinationStationId: string,
  destinationStationName: string
): Promise<RailRouteCandidate | null> {
  const searchPrompt = `${originStationName}から${destinationStationName}までの鉄道での行き方を検索して教えてください。
使用する路線名(乗換がある場合は乗車順に全て)、乗換回数、所要時間の目安を明記してください。`;

  const extractionInstruction =
    "以下の文章から、経路情報(利用路線名の配列、乗換回数、所要時間の目安)をJSON形式で抽出してください。";

  const result = await searchAndGenerateStructuredContent<GeneratedRoute>(
    apiKey,
    searchPrompt,
    extractionInstruction,
    ROUTE_SCHEMA
  );

  if (!isValidGeneratedRoute(result)) return null;

  // 検索結果からは乗換駅名まで確実には抽出できないため、複数路線にまたがる場合も
  // 単一区間としてまとめる(区間ごとに分割すると中間駅IDが実在しないダミー値になり、
  // 表示が不正確になるため)。
  return {
    originStationId,
    arrivalStationId: destinationStationId,
    transferCount: result.transferCount,
    estimatedDurationMinutes: result.estimatedMinutes,
    isAiGenerated: true,
    segments: [
      {
        fromStationId: originStationId,
        toStationId: destinationStationId,
        line: result.lines.join("・"),
        direction: destinationStationName,
        platformId: "",
        estimatedMinutes: result.estimatedMinutes,
      },
    ],
  };
}
