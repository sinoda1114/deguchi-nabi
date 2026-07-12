import { searchAndGenerateStructuredContent } from "@/lib/integrations/ai/GeminiClient";
import type { RailRouteCandidate } from "./RouteProviderPort";
import type { Station } from "@/lib/domain/station";

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
 * 同名の駅が複数の都道府県に存在するケース(例: 国際センター駅が愛知・宮城の
 * 両方に存在する)でGeminiの検索が違う駅を対象にしてしまわないよう、
 * 都道府県名(判明していれば)と概算座標を併記して曖昧性を解消するヒントを作る。
 * HeartRails由来でキャッシュ未経由の駅は prefecture が空文字列になりうるため、
 * その場合も常に取得できる座標だけは必ず含める。
 */
function locationHint(station: Station): string {
  const parts = [
    station.prefecture,
    `緯度${station.latitude.toFixed(4)}・経度${station.longitude.toFixed(4)}付近`,
  ].filter((part) => part.length > 0);
  return parts.join("、");
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
  originStation: Station,
  destinationStation: Station
): Promise<RailRouteCandidate | null> {
  const searchPrompt = `${originStation.stationName}(${locationHint(originStation)})から${destinationStation.stationName}(${locationHint(destinationStation)})までの鉄道での行き方を検索して教えてください。
同じ駅名が複数の都道府県に存在する場合は、必ず上記の位置に最も近い駅を対象にしてください。
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
    originStationId: originStation.stationId,
    arrivalStationId: destinationStation.stationId,
    transferCount: result.transferCount,
    estimatedDurationMinutes: result.estimatedMinutes,
    isAiGenerated: true,
    segments: [
      {
        fromStationId: originStation.stationId,
        toStationId: destinationStation.stationId,
        line: result.lines.join("・"),
        direction: destinationStation.stationName,
        platformId: "",
        estimatedMinutes: result.estimatedMinutes,
      },
    ],
  };
}
