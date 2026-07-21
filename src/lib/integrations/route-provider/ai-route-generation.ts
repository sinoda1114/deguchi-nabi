import { searchAndGenerateStructuredContent } from "@/lib/integrations/ai/GeminiClient";
import type { RailRouteCandidate } from "./RouteProviderPort";
import type { Station } from "@/lib/domain/station";
import { hasRepetitionArtifact } from "@/lib/domain/text-quality";

const MAX_TRANSFER_COUNT = 10;
const MAX_DURATION_MINUTES = 600;
const MAX_LINE_NAME_LENGTH = 100;
const MAX_PLATFORM_LABEL_LENGTH = 20;

// 実機検証(2026-07)で、生成された路線名がLLMの縮退生成(degenerate repetition)により
// 「瘉鉄改戳版最改版甘鉄改戳版最改版・瘉鉄改戳版最改版甘鉄改戳版最改版」のような
// 文字化けになる不具合を確認した。結果がnullの場合のみ、丸ごと1回だけ再試行する
// (合計最大2試行、destination-exit-search-pipeline.tsと同じ設計)。
const MAX_ATTEMPTS = 2;

interface GeneratedRoute {
  lines: string[];
  transferCount: number;
  estimatedMinutes: number;
  /** 到着番線(判明した場合のみ、例: "3")。検索で確認できなければモデルは省略してよい。 */
  arrivalPlatformNumber?: string;
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
    arrivalPlatformNumber: {
      type: "string",
      description: "到着番線(検索で確認できた場合のみ、例:3)。不明な場合は省略する。",
    },
  },
  required: ["lines", "transferCount", "estimatedMinutes"],
};

/**
 * 到着番線を検索結果から抽出できた場合のみ、号車推定(generateBoardingPosition)へ
 * 引き渡すための文字列を返す。型不正・空文字・異常に長い値は無理に採用せず
 * null(=未確認)として扱う(存在しない情報を無理に埋めない原則の維持)。
 */
function extractArrivalPlatformNumber(
  candidate: Pick<GeneratedRoute, "arrivalPlatformNumber">
): string | null {
  const value = candidate.arrivalPlatformNumber;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PLATFORM_LABEL_LENGTH) return null;
  return trimmed;
}

function isValidGeneratedRoute(value: unknown): value is GeneratedRoute {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.lines) &&
    candidate.lines.length > 0 &&
    candidate.lines.every(
      (l) =>
        typeof l === "string" &&
        l.trim().length > 0 &&
        l.length <= MAX_LINE_NAME_LENGTH &&
        !hasRepetitionArtifact(l)
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
 * generateRailRoute()の実処理1回分。ロジック本体はここに閉じ込め、
 * 公開関数側でnull時のみ再試行するラッパーにする
 * (destination-exit-search-pipeline.tsのattemptSearchDestinationExitViaSerper参照)。
 */
async function attemptGenerateRailRoute(
  apiKey: string,
  originStation: Station,
  destinationStation: Station
): Promise<RailRouteCandidate | null> {
  const searchPrompt = `${originStation.stationName}(${locationHint(originStation)})から${destinationStation.stationName}(${locationHint(destinationStation)})までの鉄道での行き方を検索して教えてください。
同じ駅名が複数の都道府県に存在する場合は、必ず上記の位置に最も近い駅を対象にしてください。
使用する路線名(乗換がある場合は乗車順に全て)、乗換回数、所要時間の目安を明記してください。
${destinationStation.stationName}の到着番線が検索で確認できれば、それも教えてください(確認できなければ無理に答えなくてよいです)。`;

  const extractionInstruction =
    "以下の文章から、経路情報(利用路線名の配列、乗換回数、所要時間の目安)をJSON形式で抽出してください。到着番線が文章中で確認できる場合はarrivalPlatformNumberとして含めてください(不明な場合は省略してください)。";

  const result = await searchAndGenerateStructuredContent<GeneratedRoute>(
    apiKey,
    searchPrompt,
    extractionInstruction,
    ROUTE_SCHEMA,
    "gemini-3.5-flash"
  );

  if (!isValidGeneratedRoute(result)) return null;

  const arrivalPlatformNumber = extractArrivalPlatformNumber(result);

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
        // 確認できた到着番線のラベル(例:"3")をそのまま格納する。
        // AiStationAdapter側で"pf_"接頭辞の有無により、他データソース由来の
        // platformIdと誤って番線ラベル扱いしないよう判別する
        // (isPlainArrivalPlatformLabel参照)。
        platformId: arrivalPlatformNumber ?? "",
        estimatedMinutes: result.estimatedMinutes,
      },
    ],
  };
}

/**
 * 全駅間の鉄道経路を、Gemini の Google Search Grounding で
 * 検索の裏付けを取った上で生成する(公開API)。
 *
 * 実処理はattemptGenerateRailRoute()に委譲し、結果がnull(スキーマ不正・
 * 縮退生成による反復文字列の混入等)だった場合のみ最大MAX_ATTEMPTS回まで
 * 丸ごと再試行する。例外はここで捕捉せず、呼び出し元にそのまま伝播させる
 * (内部関数の既存の例外方針を変えない)。
 */
export async function generateRailRoute(
  apiKey: string,
  originStation: Station,
  destinationStation: Station
): Promise<RailRouteCandidate | null> {
  let result: RailRouteCandidate | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await attemptGenerateRailRoute(apiKey, originStation, destinationStation);
    if (result !== null) return result;

    if (attempt < MAX_ATTEMPTS) {
      console.warn(
        `[ai-route-generation] ${attempt}回目の試行がnullだったため再試行します: origin=${originStation.stationName}, destination=${destinationStation.stationName}`
      );
    }
  }

  return result;
}
