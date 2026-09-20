/**
 * JEV (TypeSafe System One)。認証は JEV_API_KEY。失敗時は再スローし呼び出し側が fail-open する。
 */

import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import type { SingleCallNavigatorGuide } from "./single-call-navigator";

export interface JevRouteConsistencyDecision {
  isConsistent: boolean;
  reason?: string;
}

export interface JevFacilityJudgmentDecision {
  adoptCatalog: boolean;
  skipGeminiFacility: boolean;
  candidateScores: number[];
  reason?: string;
}

export interface JevFacilityJudgmentInput {
  destinationHint: string | null;
  arrivalStationName: string;
  searchText: string;
  catalogPair: { gate: { name: string } | null; exit: { name: string } | null } | null;
  geminiPairs: Array<{
    gate: { name: string } | null;
    exit: { name: string } | null;
    reason: string | null;
  }>;
  osmExitNames: readonly string[];
}

export interface JevClientConfig {
  apiKey: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1000;

function safeErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

function noulScore(answer: unknown): number {
  if (typeof answer === "object" && answer !== null && "noul" in answer) {
    const value = (answer as { noul: unknown }).noul;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

async function withJevTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const abortTimeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let raceTimeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      raceTimeoutId = setTimeout(() => {
        const error = new Error("JEV API call timed out");
        error.name = "JevTimeoutError";
        reject(error);
      }, timeoutMs);
    });
    return await Promise.race([run(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(abortTimeoutId);
    if (raceTimeoutId !== null) {
      clearTimeout(raceTimeoutId);
    }
  }
}

export async function evaluateRouteConsistency(
  a: SingleCallNavigatorGuide,
  b: SingleCallNavigatorGuide,
  config: JevClientConfig
): Promise<JevRouteConsistencyDecision> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const result = await withJevTimeout(timeoutMs, async (signal) => {
      const client = new TypeSafeClient({
        apiKey: config.apiKey,
        timeout: timeoutMs,
      });

      const lastLineA = a.lines[a.lines.length - 1];
      const lastLineB = b.lines[b.lines.length - 1];

      const state: Record<string, string | number | boolean | null> = {
        lineA: lastLineA,
        lineB: lastLineB,
        transferCountA: a.transferCount,
        transferCountB: b.transferCount,
        platformA: a.arrivalPlatformNumber ?? "不明",
        platformB: b.arrivalPlatformNumber ?? "不明",
      };

      return await client.systemOne(
        {
          state,
          questions: {
            sameRoute: noul(
              "2つの経路情報（lineA/lineB、platformA/platformB）が、同一の鉄道ルートを表していますか？路線名・番線の表記揺れ（「東横線」vs「東急東横線」、「3番線」vs「3番ホーム」等）は許容し、意味的に同じルートならtrueを返してください。乗換回数が異なる場合や、明らかに異なる路線・方向の場合はfalseを返してください。",
              {
                true: "同一ルート（表記揺れあり）",
                false: "異なるルート",
              }
            ),
          },
        },
        { signal }
      );
    });

    const sameRouteNoul = noulScore(result.answers.sameRoute);
    const isConsistent = sameRouteNoul > 0.5;

    return {
      isConsistent,
      reason: isConsistent
        ? `JEV判定: 同一ルート（確信度: ${sameRouteNoul.toFixed(2)}）`
        : `JEV判定: 異なるルート（確信度: ${(1 - sameRouteNoul).toFixed(2)}）`,
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMsg = safeErrorMessage(error);
    console.warn(
      `[JevClient] Route consistency evaluation failed (${errorName}): ${errorMsg}, falling back to rule-based`
    );
    throw error;
  }
}

export function isJevAvailable(): boolean {
  const key = process.env.JEV_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export function createJevConfig(): JevClientConfig | null {
  const apiKey = process.env.JEV_API_KEY;
  if (!apiKey) {
    return null;
  }
  return { apiKey };
}

export async function evaluateFacilityJudgment(
  input: JevFacilityJudgmentInput,
  config: JevClientConfig
): Promise<JevFacilityJudgmentDecision> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const result = await withJevTimeout(timeoutMs, async (signal) => {
      const client = new TypeSafeClient({
        apiKey: config.apiKey,
        timeout: timeoutMs,
      });

      const catalogGate = input.catalogPair?.gate?.name ?? null;
      const catalogExit = input.catalogPair?.exit?.name ?? null;
      const catalogBoth = catalogGate !== null && catalogExit !== null;

      const state: Record<string, string | number | boolean | null> = {
        destinationHint: input.destinationHint,
        arrivalStationName: input.arrivalStationName,
        searchTextPreview: input.searchText.slice(0, 500),
        catalogGate,
        catalogExit,
        catalogBoth,
        osmExitNames: input.osmExitNames.join(",") || null,
        geminiPairCount: input.geminiPairs.length,
      };

      const questions: Record<string, ReturnType<typeof noul>> = {};
      if (catalogBoth) {
        questions.adoptCatalog = noul(
          "収録カタログの改札・出口が両方あり、Gemini候補より採用すべきですか。カタログが欠けるか信用できないならfalse。地名の創作はしない。",
          {
            true: "カタログ組を採用する",
            false: "カタログ組を採用しない",
          }
        );
        questions.skipGeminiFacility = noul(
          "カタログで改札と出口が両方揃っているなら、Geminiによる改札・出口生成をスキップしてよいですか。片方だけ・カタログ無しならfalse。長文案内の生成可否はここでは見ない。",
          {
            true: "Geminiの改札・出口生成をスキップしてよい",
            false: "Geminiの改札・出口生成を使う",
          }
        );
      }

      for (let i = 0; i < input.geminiPairs.length; i++) {
        const pair = input.geminiPairs[i];
        state[`geminiGate${i}`] = pair.gate?.name ?? null;
        state[`geminiExit${i}`] = pair.exit?.name ?? null;
        questions[`preferCandidate${i}`] = noul(
          "state の destinationHint とこの候補番号の geminiGate/geminiExit を見て、他候補より目的地への到達に適切なら true。OSM 名は照合用。候補に無い名前を足してはいけない。",
          {
            true: "この候補が相対的に適切",
            false: "他の候補の方が良い",
          }
        );
      }

      if (Object.keys(questions).length === 0) {
        return {
          answers: {} as Record<string, unknown>,
        };
      }

      return await client.systemOne(
        {
          state,
          questions,
        },
        { signal }
      );
    });

    const answers = result.answers as Record<string, unknown>;
    const adoptCatalog = noulScore(answers.adoptCatalog) > 0.5;
    const skipGeminiFacility = noulScore(answers.skipGeminiFacility) > 0.5;
    const candidateScores = input.geminiPairs.map((_, i) => noulScore(answers[`preferCandidate${i}`]));

    return {
      adoptCatalog,
      skipGeminiFacility,
      candidateScores,
      reason: `JEV判断: adoptCatalog=${adoptCatalog} skipGeminiFacility=${skipGeminiFacility} scores=${candidateScores.map((s) => s.toFixed(2)).join(",")}`,
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMsg = safeErrorMessage(error);
    console.warn(`[JevClient] Facility judgment failed (${errorName}): ${errorMsg}, falling back`);
    throw error;
  }
}
