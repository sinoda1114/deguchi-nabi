import { isVerbatimInSearchText } from "@/lib/domain/facility-recommendation";
import type { NamedFacility } from "@/lib/domain/facility-recommendation";
import type { Coordinates } from "@/lib/domain/station";
import { searchAndGenerateStructuredContentWithSearchText } from "@/lib/integrations/ai/GeminiClient";
import { groundedAiConfidence } from "@/lib/integrations/station-provider/ai-generation";

const MODEL = "gemini-3.8-flash";
/** 分割生成は1回限り。フル単一呼び出し(100秒)を重ねない。 */
export const SPLIT_SEARCH_TIMEOUT_MS = 25_000;

const NAME_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    pairedName: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["name", "confidence"],
} as const;

export interface SplitFacilityNames {
  gate: NamedFacility | null;
  exit: NamedFacility | null;
}

function toNamed(name: unknown, confidence: unknown, searchText: string): NamedFacility | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return null;
  if (!isVerbatimInSearchText(trimmed, searchText)) return null;
  const level =
    confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "low";
  return {
    name: trimmed,
    confidence: groundedAiConfidence(level),
    provenance: "ai_inferred",
  };
}

function locationHint(stationName: string, stationCoordinates: Coordinates | null, destinationHint: string | null): string {
  const coord =
    stationCoordinates !== null
      ? `(緯度${stationCoordinates.lat.toFixed(4)}・経度${stationCoordinates.lng.toFixed(4)}付近)`
      : "";
  const dest = destinationHint?.trim() ? `付近の「${destinationHint.trim()}」` : "";
  return `${stationName}${coord}${dest}`;
}

export async function generateExitOnly(input: {
  apiKey: string;
  stationName: string;
  stationCoordinates: Coordinates | null;
  destinationHint: string | null;
}): Promise<{ exit: NamedFacility | null; pairedGateName: string | null }> {
  const target = locationHint(input.stationName, input.stationCoordinates, input.destinationHint);
  const result = await searchAndGenerateStructuredContentWithSearchText<{
    name: string;
    pairedName?: string;
    confidence: string;
  }>(
    input.apiKey,
    `${target} に向かうとき、到着駅で地上へ出る公式の出口名(例: A1出口、ハチ公口)を公式サイト・構内図から1つ挙げよ。創作禁止。接続改札名が分かる場合は併記。`,
    "出口名を name、接続改札名があれば pairedName、確信度を confidence に入れよ。検索テキストに無い名前は空文字。",
    NAME_SCHEMA,
    MODEL,
    SPLIT_SEARCH_TIMEOUT_MS
  );
  if (!result) return { exit: null, pairedGateName: null };
  const exit = toNamed(result.data.name, result.data.confidence, result.searchText);
  const paired = toNamed(result.data.pairedName, result.data.confidence, result.searchText);
  return { exit, pairedGateName: paired?.name ?? null };
}

export async function generateGateOnly(input: {
  apiKey: string;
  stationName: string;
  stationCoordinates: Coordinates | null;
  destinationHint: string | null;
}): Promise<{ gate: NamedFacility | null; pairedExitName: string | null }> {
  const target = locationHint(input.stationName, input.stationCoordinates, input.destinationHint);
  const result = await searchAndGenerateStructuredContentWithSearchText<{
    name: string;
    pairedName?: string;
    confidence: string;
  }>(
    input.apiKey,
    `${target} に向かうとき、到着駅で通る公式の改札名を公式サイト・構内図から1つ挙げよ。創作禁止。接続出口名が分かる場合は併記。`,
    "改札名を name、接続出口名があれば pairedName、確信度を confidence に入れよ。検索テキストに無い名前は空文字。",
    NAME_SCHEMA,
    MODEL,
    SPLIT_SEARCH_TIMEOUT_MS
  );
  if (!result) return { gate: null, pairedExitName: null };
  const gate = toNamed(result.data.name, result.data.confidence, result.searchText);
  const paired = toNamed(result.data.pairedName, result.data.confidence, result.searchText);
  return { gate, pairedExitName: paired?.name ?? null };
}

/**
 * 改札検索と出口検索を並列実行し、両方取れたときだけ組にする。
 * 片方だけなら caller が approximate 表示に使う(合格には数えない)。
 */
export async function generateSplitFacilityPair(input: {
  apiKey: string;
  stationName: string;
  stationCoordinates: Coordinates | null;
  destinationHint: string | null;
}): Promise<SplitFacilityNames> {
  const [exitResult, gateResult] = await Promise.all([
    generateExitOnly(input),
    generateGateOnly(input),
  ]);

  const exit = exitResult.exit;
  let gate = gateResult.gate;

  if (exit && exitResult.pairedGateName && !gate) {
    gate = {
      name: exitResult.pairedGateName,
      confidence: exit.confidence,
      provenance: "ai_inferred",
    };
  }

  return { gate, exit };
}
