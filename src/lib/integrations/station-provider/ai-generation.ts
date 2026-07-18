import { randomUUID } from "node:crypto";
import type {
  BoardingPosition,
  Coordinates,
  FacilityType,
  StationFacility,
} from "@/lib/domain/station";
import type { Confidence, ConfidenceLevel } from "@/lib/domain/confidence";
import { capConfidenceForProvenance } from "@/lib/domain/confidence";
import { searchAndGenerateStructuredContent } from "@/lib/integrations/ai/GeminiClient";

const AI_GENERATED_REASON =
  "AIによる推測情報(検索結果に基づく)。現地未確認のため参考程度に扱ってください。";
const MAX_CAR_NUMBER = 16;
const MAX_TEXT_LENGTH = 200;
/**
 * 号車推定のreasonのみ、facility name/level等より長い上限を許容する。
 * 「到着番線や編成によって結果が変わる場合は条件を含める」プロンプト指示
 * (例:「3番線着の場合は3号車、5番線着の場合は5号車」)により、モデルの
 * 回答が旧プロンプトより長くなりやすいため、MAX_TEXT_LENGTHのままだと
 * 有効な回答まで文字数超過で丸ごと棄却されうる(carNumber/doorPositionが
 * 正しくてもisValidBoardingPositionがreasonの長さだけでfalseを返してしまう)。
 */
const MAX_REASON_LENGTH = 300;
/** fixtureのplatformIdは常に "pf_" 接頭辞を持つ(fixtures/stations.ts参照)。
 * AI生成ルート(ai-route-generation.ts)由来の到着番線文字列(例: "3")と、
 * fixture由来の実在platformIdを取り違えないための判定に使う。 */
const FIXTURE_PLATFORM_ID_PREFIX = "pf_";

const VALID_CONFIDENCE_LEVELS: ConfidenceLevel[] = ["high", "medium", "low"];

/**
 * モデルが自己申告したconfidenceを、"ai_inferred"の上限(medium)にキャップして
 * Confidenceオブジェクトを組み立てる。arrival-guide-ai-generation.tsと同じ方針
 * (モデルの自己申告をそのまま採用しない。docs/04 §Phase 2.5)。
 */
function groundedAiConfidence(selfReportedLevel: ConfidenceLevel): Confidence {
  return {
    level: capConfidenceForProvenance(selfReportedLevel, "ai_inferred"),
    reasons: [AI_GENERATED_REASON],
    verifiedAt: null,
    expiresAt: null,
    sourceCount: 0,
  };
}

/**
 * 同名の改札・出口・駅名が複数存在するケースでGeminiの検索が違う駅を対象に
 * してしまわないよう、概算座標を併記して曖昧性を解消するヒントを作る
 * (arrival-guide-ai-generation.ts / ai-route-generation.ts と同じ狙い)。
 */
function locationHint(coordinates: Coordinates | null): string {
  if (!coordinates) return "";
  return `(緯度${coordinates.lat.toFixed(4)}・経度${coordinates.lng.toFixed(4)}付近)`;
}

function isNonEmptyText(value: unknown, maxLength: number = MAX_TEXT_LENGTH): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isValidConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return typeof value === "string" && VALID_CONFIDENCE_LEVELS.includes(value as ConfidenceLevel);
}

interface GeneratedFacility {
  facilityType: FacilityType;
  name: string;
  level: string;
  confidence: ConfidenceLevel;
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
    isNonEmptyText(candidate.level) &&
    isValidConfidenceLevel(candidate.confidence)
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
          confidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
        },
        required: ["facilityType", "name", "level", "confidence"],
      },
    },
  },
  required: ["facilities"],
};

/**
 * 駅の改札・出口・エスカレーター/エレベーターの下書き情報を、Google Search
 * Groundingで検索の裏付けを取った上で生成する(旧実装はグラウンディングなしの
 * generateStructuredContentを使っており、モデル内部知識のみで構内図等の
 * 実検索照合が一切行われていなかった。乗換案内の精度改善のための変更)。
 *
 * 鉄道会社公式の駅構内図・公式サイトを最優先の情報源とするようプロンプトで
 * 明示し、確認できない施設は創作させない(既存のarrival-guide-ai-generation.ts
 * / ai-route-generation.tsと同じ設計原則)。同名駅の曖昧性解消のため、
 * coordinatesが渡された場合は緯度経度のヒントも検索プロンプトに含める。
 *
 * 検索グラウンディングが働かなかった場合や、応答が不正な場合(facilitiesが
 * 配列でない等)は空配列を返す(根拠のない推測で埋めないため。過去のレビュー
 * 指摘: 配列であることを検証せず.filter()を呼ぶと実行時エラーになる)。
 */
export async function generateStationFacilities(
  apiKey: string,
  stationName: string,
  operator: string,
  lines: string[],
  coordinates: Coordinates | null = null,
  destinationHint: string | null = null
): Promise<StationFacility[]> {
  const stationLabel = operator
    ? `${stationName}(${operator}、${lines.join("・")})${locationHint(coordinates)}`
    : `${stationName}(${lines.join("・")})${locationHint(coordinates)}`;

  // destinationHint(目的地施設名)がある場合、駅全体の主要な改札・出口の回答を
  // 維持したまま、目的地へのアクセス情報も追加で検索するよう指示する(加算型)。
  // 当初は「目的地に最も近い改札・出口を優先して調べる」という絞り込み型の
  // 指示文だったが、本番同一構成でのE2E検証(西谷駅→kawara CAFE&DINING横浜店等)で
  // 絞り込み型の方が駅全体検索より改札・出口の確認精度が悪化する(すべて
  // 「確認できません」になる)ことを確認した。「目的地との近さを優先して調べて」
  // という指示が、下記の「確認できない設備は創作しない」という保守的ルールと
  // 相互作用し、目的地との近さそのものを公式資料で確認できない場合に駅全体の
  // 回答まで抑制してしまうのが原因と推定している(council議論)。加算型では
  // 「駅全体の回答とは別に」「確認できなかった場合でも駅の主要な改札・出口の
  // 回答は通常どおり行う」と明示することで、目的地アクセス情報が見つからない
  // 場合でも駅全体の回答自体は抑制されないようにする。
  const destinationInstruction = destinationHint
    ? `\nまた、上記の駅全体の回答とは別に、「${destinationHint}」へのアクセス情報(最寄り改札・出口)も検索してください。目的地の公式サイト・グルメサイト等のアクセス情報ページで最寄り改札・出口が確認できた場合は、それも回答に追加してください。確認できなかった場合でも、駅の主要な改札・出口の回答は通常どおり行ってください。`
    : "";

  const searchPrompt = `${stationLabel}の主要な改札名・出口名・エスカレーター/エレベーターの位置について検索して教えてください。${destinationInstruction}
鉄道会社公式の駅構内図・公式サイトを最優先の情報源としてください。
同じ駅名が他にも存在する場合は、必ず上記の位置に最も近い駅を対象にしてください。
公式資料等で確認できない改札・出口・設備は創作せず、確認できたもの数件に絞って回答してください。`;

  const extractionInstruction = `以下の文章から、確認できた改札・出口・エスカレーター/エレベーターの情報をJSON形式で抽出してください。
確信が持てないものは含めないでください。各項目について、あなた自身がその情報にどれだけ自信があるかをhigh/medium/lowで自己申告してください(自信が持てない場合はその項目自体を含めないでください)。`;

  const result = await searchAndGenerateStructuredContent<{ facilities: GeneratedFacility[] }>(
    apiKey,
    searchPrompt,
    extractionInstruction,
    FACILITIES_SCHEMA
  );

  if (!Array.isArray(result?.facilities)) return [];

  return result.facilities.filter(isValidFacility).map((f) => ({
    facilityId: randomUUID(),
    stationId: "",
    facilityType: f.facilityType,
    name: f.name,
    level: f.level,
    accessible: f.facilityType === "elevator",
    coordinates: null,
    // AI生成は座標・出口→改札の連結を持たないため、目的地座標に応じた
    // 出口選定の対象にはならない(常に従来通りの先頭一致で扱われる)。
    connectedGateId: null,
    confidence: groundedAiConfidence(f.confidence),
    verifiedAt: null,
    provenance: "ai_inferred",
  }));
}

interface GeneratedBoardingPosition {
  carNumber: number;
  doorPosition: "前方" | "中央" | "後方";
  reason: string;
  confidence: ConfidenceLevel;
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
    isNonEmptyText(candidate.reason, MAX_REASON_LENGTH) &&
    isValidConfidenceLevel(candidate.confidence)
  );
}

const BOARDING_SCHEMA = {
  type: "object",
  properties: {
    carNumber: { type: "integer" },
    doorPosition: { type: "string", enum: VALID_DOOR_POSITIONS },
    reason: { type: "string" },
    confidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
  },
  required: ["carNumber", "doorPosition", "reason", "confidence"],
};

/**
 * fixtureのplatformIdの実際の値ではなく、AI生成ルート(ai-route-generation.ts)
 * が検索で確認できた到着番線ラベル(例:"3")をそのまま乗車位置生成のヒントに
 * 使ってよいかを判定する。"pf_"接頭辞のfixture platformIdは、呼び出し元の
 * データ不整合(別駅のplatformId)が渡された場合に、無関係な文字列をそのまま
 * プロンプトへ混入させないよう除外する(CompositeStationAdapter.getBoardingPosition
 * 側で使用)。
 */
export function isPlainArrivalPlatformLabel(platformId: string): boolean {
  return platformId.length > 0 && !platformId.startsWith(FIXTURE_PLATFORM_ID_PREFIX);
}

/**
 * 号車・ドア位置の下書き情報を、Google Search Groundingで検索の裏付けを
 * 取った上で生成する(旧実装はグラウンディングなしのgenerateStructuredContentを
 * 使っており、「一般的に知られている情報」という曖昧な指示のみだった)。
 *
 * 到着ホーム上の階段・エスカレーター・改札に近い停止位置と、列車の進行方向・
 * 編成両数を明示的に照合して号車を決定するようプロンプトで指示する。到着番線
 * や編成によって結果が変わる場合は、その条件をreasonに含めさせる(GPTの検索
 * 手順との比較調査に基づく)。arrivalPlatformNumberが判明していれば検索
 * プロンプトに含め、その番線を優先して回答させる。
 *
 * 検索グラウンディングが働かなかった場合や、応答が不正な場合はnullを返す
 * (根拠のない推測で埋めないため)。
 */
export async function generateBoardingPosition(
  apiKey: string,
  stationName: string,
  line: string,
  direction: string,
  platformId: string,
  arrivalPlatformNumber: string | null = null
): Promise<BoardingPosition | null> {
  const platformHint = arrivalPlatformNumber
    ? `到着番線は${arrivalPlatformNumber}番線と判明しています。この番線での状況を優先して回答してください。`
    : "";

  const searchPrompt = `${stationName}から${direction}へ向かう${line}について、到着ホーム上の階段・エスカレーター・改札に近い停止位置(号車・ドア位置)を検索して教えてください。
${platformHint}
到着ホーム上の階段・エスカレーター・改札に近い停止位置と、列車の進行方向・編成両数を明示的に照合して号車を決定してください。
到着番線や編成によって結果が変わる場合は、その条件(例:◯番線着の場合は◯号車)を含めて教えてください。
確信が持てない場合は無理に回答せず、確認できた範囲の最も一般的な情報のみ教えてください。`;

  const extractionInstruction = `以下の文章から、乗車位置情報(号車・ドア位置・理由)をJSON形式で抽出してください。
理由(reason)には、到着番線や編成によって結果が変わる場合の条件(例:◯番線着の場合は◯号車)を含めてください。
ただしreasonは150字程度までの簡潔な文章にまとめてください。
あなた自身がその情報にどれだけ自信があるかをhigh/medium/lowで自己申告してください。`;

  const result = await searchAndGenerateStructuredContent<GeneratedBoardingPosition>(
    apiKey,
    searchPrompt,
    extractionInstruction,
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
    confidence: groundedAiConfidence(result.confidence),
    verifiedAt: null,
  };
}
