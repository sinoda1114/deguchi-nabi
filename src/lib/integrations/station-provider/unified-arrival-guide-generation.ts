import { searchAndGenerateStructuredContent } from "@/lib/integrations/ai/GeminiAiSdkClient";
import type { ConfidenceLevel } from "@/lib/domain/confidence";
import type { Coordinates } from "@/lib/domain/station";
import { locationHint } from "./ai-generation";

/**
 * 改札・出口・改札後の徒歩ルートを1回の検索セッションで統合生成するバックエンド。
 *
 * council議論(2026-07-20): 実機比較で「西谷駅から目的地までの号車・改札・出口・
 * 徒歩ルートを1つのシステムプロンプトで一括検索させる」方式(Geminiチャットでの
 * 実演)が、既存の分割方式(facilities一覧生成→座標ベースの出口選定→改札後導線を
 * 別セッションでさらに推測)より明確に高精度だった。分割方式の弱点は主に2つ:
 * (1) AI生成facilityは座標を持たないため、目的地座標に基づく出口選定ロジック
 * (route-search.ts resolveExitRecommendation)の対象外になり、目的地が駅そのもの
 * でない限り常に「確認できません」に落ちる構造的な問題があった。
 * (2) 改札後導線(arrival-guide-ai-generation.ts)は、既に(不確かな)AI推定で
 * 決まった改札・出口の「間」をさらに別セッションで推測する二段重ねの設計で、
 * canGenerateNarrative(arrival-guide.ts)がgate/exitのどちらかがAI推定の場合は
 * 生成自体を止める安全策を取っていた(不確かな情報の上に不確かな情報を重ねる
 * リスクを避けるため)。統合生成は同一検索セッションで改札・出口・徒歩ルートを
 * 一貫して回答させるため、この「別々の推測を重ねる」問題自体が発生しない。
 *
 * モデルはgemini-3.5-flashを使う(gemini-3.1-pro-previewとの比較で、検索実行の
 * 安定性・応答速度・コストのバランスが良かったため。gemini-3.1-flash-liteは
 * ツール呼び出し判断が弱く検索を実行しないケースがあり不採用)。
 *
 * 目的地がplace由来(destinationHintあり)の場合、絞り込み型の指示
 * (「目的地に最も近い改札・出口を検索して」)を使う。旧Groundingモデル+旧分割
 * プロンプトでは絞り込み型が「確認できない設備は創作しない」という保守的ルールと
 * 相互作用し駅全体の回答まで抑制する回帰が実測されていたが(ai-generation.ts
 * generateStationFacilitiesのコメント参照)、gemini-3.5-flash+この統合プロンプト
 * では同じ問題は再現しなかった(西谷駅→kawara CAFE&DINING横浜店のドライランで
 * 改札名・出口名・徒歩ルートまで具体的に取得できることを確認済み)。
 */

const MODEL = "gemini-3.5-flash";
const MAX_TEXT_LENGTH = 200;
const MAX_WALKING_STEPS = 6;

const VALID_CONFIDENCE_LEVELS: ConfidenceLevel[] = ["high", "medium", "low"];

export interface UnifiedArrivalGuideResult {
  gate: { name: string; confidenceLevel: ConfidenceLevel } | null;
  exit: { name: string; confidenceLevel: ConfidenceLevel } | null;
  walkingSteps: { title: string; instruction: string; confidenceLevel: ConfidenceLevel }[];
}

interface GeneratedUnifiedArrivalGuide {
  gateName?: string;
  gateConfidence?: ConfidenceLevel;
  exitName?: string;
  exitConfidence?: ConfidenceLevel;
  walkingSteps?: { title: string; instruction: string; confidence: ConfidenceLevel }[];
}

const UNIFIED_ARRIVAL_GUIDE_SCHEMA = {
  type: "object",
  properties: {
    gateName: { type: "string" },
    gateConfidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
    exitName: { type: "string" },
    exitConfidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
    walkingSteps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          instruction: { type: "string" },
          confidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
        },
        required: ["title", "instruction", "confidence"],
      },
    },
  },
  required: ["walkingSteps"],
};

function isNonEmptyText(value: unknown, maxLength: number = MAX_TEXT_LENGTH): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isValidConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return typeof value === "string" && VALID_CONFIDENCE_LEVELS.includes(value as ConfidenceLevel);
}

function isValidWalkingStep(
  value: unknown
): value is { title: string; instruction: string; confidence: ConfidenceLevel } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyText(candidate.title) &&
    isNonEmptyText(candidate.instruction) &&
    isValidConfidenceLevel(candidate.confidence)
  );
}

export async function generateUnifiedArrivalGuide(
  apiKey: string,
  originStationName: string,
  destinationStationName: string,
  destinationOperator: string,
  destinationLines: string[],
  destinationHint: string | null,
  stationCoordinates: Coordinates | null,
  destinationPlaceCoordinates: Coordinates | null
): Promise<UnifiedArrivalGuideResult | null> {
  const stationLabel = destinationOperator
    ? `${destinationStationName}駅(${destinationOperator}、${destinationLines.join("・")})${locationHint(stationCoordinates)}`
    : `${destinationStationName}駅(${destinationLines.join("・")})${locationHint(stationCoordinates)}`;

  // destinationHint(目的地施設名)自体は駅名等と曖昧衝突しうる一般的な名称の
  // 場合があるため、目的地自体の実座標(stationCoordinatesとは別物、駅の
  // 中心座標ではなく目的地施設の座標)も併記して曖昧性解消のヒントにする
  // (/ai-review指摘、Medium: 旧実装は駅座標のみを渡し目的地の実座標を
  // AIへ渡していなかった)。
  const destinationLabel = destinationHint
    ? `${stationLabel}付近の「${destinationHint}」${locationHint(destinationPlaceCoordinates)}`
    : stationLabel;

  const searchPrompt = `あなたは日本の鉄道に詳しい乗換えナビゲーターです。ユーザーは「${originStationName}駅」から「${destinationLabel}」へ向かうルートを知りたいと考えています。
回答時には必ずインターネット検索を行い、最新かつ正確な改札・出口・徒歩ルート情報を取得し、出力前にファクトチェックを行います。

【回答すべき情報】
1. ${stationLabel}で降りるべき改札名(${destinationHint ? "目的地に最も近いもの" : "主要な改札"})
2. その改札を出て利用すべき出口名
3. 改札を出てから目的地までの徒歩ルート(目印を含む、簡潔に)

【制約】
- 鉄道会社公式の駅構内図・公式サイトを最優先の情報源としてください。
- 同じ駅名が他にも存在する場合は、必ず上記の位置に最も近い駅を対象にしてください。
- 確証がない場合は「確認できません」と明示し、推測による回答は行わない。実在しない改札名・出口名を創作しないでください。`;

  const extractionInstruction = `以下の文章から、改札名・出口名・徒歩ルートの情報をJSON形式で抽出してください。
確信が持てない項目は含めないでください(改札名・出口名が確認できない場合はgateName/exitNameのプロパティ自体を省略してください)。
徒歩ルートの各ステップには、短い見出し(title、例:「改札を出て直進」)と詳しい説明(instruction)の両方を含めてください。
各項目について、あなた自身がその情報にどれだけ自信があるかをhigh/medium/lowで自己申告してください。`;

  const result = await searchAndGenerateStructuredContent<GeneratedUnifiedArrivalGuide>(
    apiKey,
    searchPrompt,
    extractionInstruction,
    UNIFIED_ARRIVAL_GUIDE_SCHEMA,
    "unified-arrival-guide-generation",
    MODEL
  );

  if (!result) return null;

  const gate =
    isNonEmptyText(result.gateName) && isValidConfidenceLevel(result.gateConfidence)
      ? { name: result.gateName, confidenceLevel: result.gateConfidence }
      : null;
  const exit =
    isNonEmptyText(result.exitName) && isValidConfidenceLevel(result.exitConfidence)
      ? { name: result.exitName, confidenceLevel: result.exitConfidence }
      : null;
  const walkingSteps = Array.isArray(result.walkingSteps)
    ? result.walkingSteps
        .filter(isValidWalkingStep)
        .slice(0, MAX_WALKING_STEPS)
        .map((step) => ({
          title: step.title,
          instruction: step.instruction,
          confidenceLevel: step.confidence,
        }))
    : [];

  return { gate, exit, walkingSteps };
}
