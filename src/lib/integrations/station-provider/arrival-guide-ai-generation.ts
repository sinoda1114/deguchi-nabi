// Vercel AI SDK版クライアントを使用する(縦切りPoC対象箇所)。GeminiClient.ts自体・
// ai-route-generation.ts / station-provider/ai-generation.ts の Search Grounding呼び出しは
// 今回のスコープ外のため変更していない(docs参照)。
import { searchAndGenerateStructuredContent } from "@/lib/integrations/ai/GeminiAiSdkClient";
import type { GuideStep, GuideStepType } from "@/lib/domain/route";
import type { ConfidenceLevel } from "@/lib/domain/confidence";
import { capConfidenceForProvenance } from "@/lib/domain/confidence";
import type { Coordinates } from "@/lib/domain/station";

const MAX_TEXT_LENGTH = 200;
const MAX_STEPS = 8;

/**
 * AIに生成させてよいステップ種別。改札(gateName)から出口(exitName)までの
 * 「間」の導線に限定する。street_exitは既に確定済みのexit facilityから
 * 別途生成済み(重複表示を避けるため)、platform_facilityは改札より手前
 * (ホーム側)の概念でありここでの導線の対象外、boarding/alighting/
 * ticket_gate/destination_directionは他の既存ロジックが扱うため、
 * いずれもここでは生成させない(AIレビュー指摘に基づく)。
 */
const NARRATIVE_STEP_TYPES: GuideStepType[] = [
  "post_gate_direction",
  "public_passage",
  "underground_mall",
];

const VALID_CONFIDENCE_LEVELS: ConfidenceLevel[] = ["high", "medium", "low"];

interface GeneratedNarrativeStep {
  type: GuideStepType;
  title: string;
  instruction: string;
  confidence: ConfidenceLevel;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function isValidNarrativeStep(value: unknown): value is GeneratedNarrativeStep {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    NARRATIVE_STEP_TYPES.includes(candidate.type as GuideStepType) &&
    isNonEmptyText(candidate.title) &&
    isNonEmptyText(candidate.instruction) &&
    typeof candidate.confidence === "string" &&
    VALID_CONFIDENCE_LEVELS.includes(candidate.confidence as ConfidenceLevel)
  );
}

const NARRATIVE_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: NARRATIVE_STEP_TYPES },
          title: { type: "string" },
          instruction: { type: "string" },
          confidence: { type: "string", enum: VALID_CONFIDENCE_LEVELS },
        },
        required: ["type", "title", "instruction", "confidence"],
      },
    },
  },
  required: ["steps"],
};

/**
 * 同名の改札・出口名(「中央改札」「東口」等)が複数の駅に存在するケースで
 * Geminiの検索が違う駅を対象にしてしまわないよう、概算座標を併記して
 * 曖昧性を解消するヒントを作る(ai-route-generation.tsのlocationHintと
 * 同じ狙い。AIレビュー指摘に基づく)。
 */
function locationHint(coordinates: Coordinates | null): string {
  if (!coordinates) return "";
  return `(緯度${coordinates.lat.toFixed(4)}・経度${coordinates.lng.toFixed(4)}付近)`;
}

/**
 * 改札(gateName)から出口(exitName)までの改札後方向・自由通路・地下街等の
 * 詳細導線を、Google Search Groundingで検索の裏付けを取った上で生成する。
 * fixtureにこの粒度のデータが無い駅・区間向けの補完(docs/04 §Phase 2.5)。
 *
 * 実在しない改札名・通路名・地下街名を創作しない/確信が持てない区間は
 * 無理に埋めないよう、プロンプトで明示的に指示する。モデル自身が申告する
 * confidenceは参考値に留め、capConfidenceForProvenance()で"ai_inferred"の
 * 上限(medium)にキャップする(モデルの自己申告をそのまま採用しない)。
 *
 * 検索グラウンディングが働かなかった場合や、応答が不正な場合は空配列を返す
 * (根拠のない推測でステップを埋めないため。GeminiClientの既存パターンを踏襲)。
 */
export async function generateArrivalNarrativeSteps(
  apiKey: string,
  stationName: string,
  gateName: string,
  exitName: string,
  arrivalStationCoordinates: Coordinates | null = null
): Promise<GuideStep[]> {
  const stationLabel = `${stationName}${locationHint(arrivalStationCoordinates)}`;
  const searchPrompt = `${stationLabel}で「${gateName}」を出てから「${exitName}」まで実際にどう歩くか検索して教えてください。
同じ改札名・出口名が他の駅に存在する場合は、必ず上記の位置に最も近い駅を対象にしてください。
改札を出た後の進行方向、通過する自由通路や地下街の名称があれば、実在が確認できる範囲で教えてください。
確実な情報が見つからない場合は、無理に経路をつなげず、分かる範囲だけ答えてください。
存在しない改札名・出口名・通路名・地下街名を創作しないでください。
左右の方向は、向いている基準(例:「改札に向かって」)が明確にできる場合のみ答えてください。基準が不明なら方向は答えないでください。`;

  const extractionInstruction = `以下の文章から、「${gateName}」から「${exitName}」までの経路上のステップをJSON形式で抽出してください。
各ステップは post_gate_direction(改札を出た後の方向)、public_passage(自由通路)、underground_mall(地下街)のいずれかに分類してください。
情報が無い区間は無理に埋めず、確実な区間のみ抽出してください。
confidenceは、あなた自身がその情報にどれだけ自信があるかをhigh/medium/lowで答えてください(自信が持てない場合はそのステップ自体を含めないでください)。`;

  const result = await searchAndGenerateStructuredContent<{
    steps: GeneratedNarrativeStep[];
  }>(
    apiKey,
    searchPrompt,
    extractionInstruction,
    NARRATIVE_SCHEMA,
    "arrival-guide-narrative-steps"
  );

  if (!Array.isArray(result?.steps)) return [];

  return result.steps
    .filter(isValidNarrativeStep)
    .slice(0, MAX_STEPS)
    .map((step) => ({
      type: step.type,
      title: step.title,
      instruction: step.instruction,
      landmarks: [],
      confidence: {
        level: capConfidenceForProvenance(step.confidence, "ai_inferred"),
        reasons: ["AIによる推測情報(検索結果に基づく)。現地未確認のため参考程度に扱ってください。"],
        verifiedAt: null,
        expiresAt: null,
        sourceCount: 0,
      },
      provenance: "ai_inferred",
    }));
}
