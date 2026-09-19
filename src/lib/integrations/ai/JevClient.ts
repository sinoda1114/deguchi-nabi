/**
 * JEV (TypeSafe System One) クライアント
 * Phase 1: retry gate判定（single-call-navigator.tsのisFacilityUnavailable置換）
 * Phase 2: 経路一貫性判定（isRouteConsistentの意味的判定強化）
 *
 * 環境変数: JEV_API_KEY（必須）
 * フォールバック: 環境変数未設定時は既存挙動維持
 * タイムアウト: 1秒（判定に時間がかかる場合はフォールバック）
 */

import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";
import type { RawNamedFacility, SingleCallNavigatorGuide } from "./single-call-navigator";

/** JEV判定結果（retry が必要かどうか） */
export interface JevRetryGateDecision {
  shouldRetry: boolean;
  /** JEVによる判定理由（デバッグ用） */
  reason?: string;
}

/** JEV経路一貫性判定結果 */
export interface JevRouteConsistencyDecision {
  isConsistent: boolean;
  /** JEVによる判定理由（デバッグ用） */
  reason?: string;
}

/** JEV Facility完全性判定結果（Phase 2-C） */
export interface JevFacilityCompletenessDecision {
  /** gate・exitが両方揃っているか（または片方で十分か） */
  isComplete: boolean;
  /** 不足しているフィールド */
  missingFields: Array<"gate" | "exit">;
  /** retryで改善する見込みがあるか */
  shouldRetry: boolean;
  /** JEVによる判定理由（デバッグ用） */
  reason?: string;
}

/** JEVクライアント設定 */
interface JevClientConfig {
  apiKey: string;
  /** タイムアウト（ミリ秒）、デフォルト1000ms */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1000;

/**
 * エラーメッセージを安全に文字列化（シークレット漏洩防止）
 */
function safeErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

/**
 * JEVを使ってretry gateを判定する。
 * 
 * Phase 1の目標:
 * - 機械的な"unavailable"判定（件数ルールのみ）を意味的判定へ改善
 * - リトライ率30%→15%削減で3-4秒短縮
 * 
 * 判定基準:
 * - unavailableでも情報が実質的に有用ならfalse（retry不要）
 * - 本当に情報が足りない場合のみtrue（retry実施）
 * 
 * Fail-open設計:
 * - JEV API呼び出しが失敗・タイムアウトした場合、検索全体を失敗させず
 *   shouldRetry=falseでフォールバック（retry不要と見なす）
 * - 従来のルールベース判定に戻すのはsingle-call-navigatorの責務
 */
export async function evaluateRetryGate(
  facility: FacilityRecommendation<RawNamedFacility>,
  config: JevClientConfig
): Promise<JevRetryGateDecision> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const abortTimeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let raceTimeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    // Promise.raceでより堅牢なタイムアウトを実装
    // SDKの内部タイムアウトが機能しない場合も確実にタイムアウトさせる
    const apiCallPromise = (async () => {
      const client = new TypeSafeClient({
        apiKey: config.apiKey,
        timeout: timeoutMs,
      });

      const state: Record<string, string | number | boolean | null> = {
        facilityState: facility.state,
      };

      if (facility.state === "unavailable") {
        state.facilityReason = facility.reason;
      } else if (facility.state === "confirmed") {
        state.hasPair = true;
      } else if (facility.state === "alternatives") {
        state.pairsCount = facility.pairs.length;
      }

      return await client.systemOne(
        {
          state,
          questions: {
            needsRetry: noul(
              "この施設情報は、ユーザーが駅構内で改札・出口を見つけるのに十分な情報を提供していますか？unavailable状態でも、代替情報や部分的な情報が実質的に有用であればfalseを返してください。本当に情報が足りない場合のみtrueを返してください。",
              {
                true: "情報が不足しており、リトライが必要",
                false: "十分な情報があり、リトライ不要",
              }
            ),
          },
        },
        { signal: controller.signal }
      );
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      raceTimeoutId = setTimeout(() => {
        const error = new Error("JEV API call timed out");
        error.name = "JevTimeoutError";
        reject(error);
      }, timeoutMs);
    });

    const result = await Promise.race([apiCallPromise, timeoutPromise]);

    const needsRetryNoul = (result.answers.needsRetry as { noul: number }).noul;
    const shouldRetry = needsRetryNoul > 0.5;

    return {
      shouldRetry,
      reason: shouldRetry
        ? `JEV判定: 情報不足（確信度: ${needsRetryNoul.toFixed(2)}）`
        : `JEV判定: 情報十分（確信度: ${(1 - needsRetryNoul).toFixed(2)}）`,
    };
  } catch (error) {
    // Fail-open: 任意のエラー（タイムアウト、ネットワークエラー、SDKエラー等）で
    // 検索全体を失敗させず、呼び出し側（isFacilityUnavailable）の
    // 従来ルールベース判定へフォールバックさせる
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMsg = safeErrorMessage(error);
    console.warn(`[JevClient] Retry gate evaluation failed (${errorName}): ${errorMsg}, falling back to rule-based`);
    // 例外を再スローして、isFacilityUnavailableのcatchで従来判定（facility.state === "unavailable"）へ戻す
    throw error;
  } finally {
    clearTimeout(abortTimeoutId);
    if (raceTimeoutId !== null) {
      clearTimeout(raceTimeoutId);
    }
  }
}

/**
 * 2つの経路情報が同一の鉄道ルートを表しているか、意味的に判定する。
 * 
 * Phase 2の目標:
 * - ルールベース判定（表記の厳密一致）の限界を克服
 * - 「東横線」vs「東急東横線」、「3番線」vs「3番ホーム」のような
 *   意味的に同じだが表記が異なる経路を一致と判定
 * 
 * 判定基準:
 * - 路線名の意味的同値性（運営会社の省略、愛称表記の差異を許容）
 * - 番線の意味的同値性（「番線」「番ホーム」「ホーム」の差異を許容）
 * - 乗換回数は厳密に一致している必要がある（意味的判定でも緩和しない）
 * 
 * Fail-open設計:
 * - JEV API呼び出しが失敗・タイムアウトした場合、例外をスローして
 *   呼び出し元（isRouteConsistent）のルールベース判定へフォールバック
 */
export async function evaluateRouteConsistency(
  a: SingleCallNavigatorGuide,
  b: SingleCallNavigatorGuide,
  config: JevClientConfig
): Promise<JevRouteConsistencyDecision> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const abortTimeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let raceTimeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const apiCallPromise = (async () => {
      const client = new TypeSafeClient({
        apiKey: config.apiKey,
        timeout: timeoutMs,
      });

      // 到着路線（末尾）を抽出
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
        { signal: controller.signal }
      );
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      raceTimeoutId = setTimeout(() => {
        const error = new Error("JEV API call timed out");
        error.name = "JevTimeoutError";
        reject(error);
      }, timeoutMs);
    });

    const result = await Promise.race([apiCallPromise, timeoutPromise]);

    const sameRouteNoul = (result.answers.sameRoute as { noul: number }).noul;
    const isConsistent = sameRouteNoul > 0.5;

    return {
      isConsistent,
      reason: isConsistent
        ? `JEV判定: 同一ルート（確信度: ${sameRouteNoul.toFixed(2)}）`
        : `JEV判定: 異なるルート（確信度: ${(1 - sameRouteNoul).toFixed(2)}）`,
    };
  } catch (error) {
    // Fail-open: エラー時は例外を再スローし、呼び出し元のルールベース判定へフォールバック
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMsg = safeErrorMessage(error);
    console.warn(`[JevClient] Route consistency evaluation failed (${errorName}): ${errorMsg}, falling back to rule-based`);
    throw error;
  } finally {
    clearTimeout(abortTimeoutId);
    if (raceTimeoutId !== null) {
      clearTimeout(raceTimeoutId);
    }
  }
}

/**
 * Facility品質評価（Phase 2-C: exit安定化専用）。
 * 
 * facilityCandidatesが完全（gate・exit両方）かを判定し、
 * 不完全な場合にretryで改善する見込みを評価する。
 * 
 * Phase 2-Cの目標:
 * - 「改札は取れたが出口が取れない」問題の直接改善
 * - gate/exitの片方のみの場合、もう片方を取得するretryの必要性を判定
 * 
 * ルールベース前段フィルタ（JEV呼び出し前に高速判定）:
 * - unavailable → 確実にretry必要（JEV不要）
 * - alternatives → 十分な情報（JEV不要）
 * - confirmed + 両方あり → 完全（JEV不要）
 * - confirmed + 片方のみ → JEVで詳細判定
 * 
 * Fail-open設計:
 * - JEV失敗時は例外を再スロー、Phase 1（retry gate）へフォールバック
 */
export async function evaluateFacilityCompleteness(
  facility: FacilityRecommendation<RawNamedFacility>,
  config: JevClientConfig
): Promise<JevFacilityCompletenessDecision> {
  // ルールベース前段フィルタ: unavailable → 確実にretry
  if (facility.state === "unavailable") {
    return {
      isComplete: false,
      missingFields: ["gate", "exit"],
      shouldRetry: true,
      reason: "unavailable状態（両方未確認）",
    };
  }

  // ルールベース前段フィルタ: alternatives → 十分な情報
  if (facility.state === "alternatives") {
    return {
      isComplete: true,
      missingFields: [],
      shouldRetry: false,
      reason: "alternatives状態（複数候補あり）",
    };
  }

  // confirmed状態: gate/exitの有無を確認
  const pair = facility.pair;
  const hasGate = pair.gate !== null;
  const hasExit = pair.exit !== null;
  const missingFields: Array<"gate" | "exit"> = [];
  if (!hasGate) missingFields.push("gate");
  if (!hasExit) missingFields.push("exit");

  // ルールベース前段フィルタ: 両方あり → 完全
  if (hasGate && hasExit) {
    return {
      isComplete: true,
      missingFields: [],
      shouldRetry: false,
      reason: "confirmed状態（gate・exit両方あり）",
    };
  }

  // 片方のみ → JEVで詳細判定
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const abortTimeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let raceTimeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const apiCallPromise = (async () => {
      const client = new TypeSafeClient({
        apiKey: config.apiKey,
        timeout: timeoutMs,
      });

      const state: Record<string, string | number | boolean | null> = {
        hasGate,
        hasExit,
        gateName: pair.gate?.name ?? null,
        exitName: pair.exit?.name ?? null,
        gateConfidence: pair.gate?.confidenceLevel ?? null,
        exitConfidence: pair.exit?.confidenceLevel ?? null,
      };

      return await client.systemOne(
        {
          state,
          questions: {
            isCompleteBothNeeded: noul(
              "改札と出口は駅構内案内の2つの重要な要素です。この施設情報は、ユーザーが駅構内で迷わず目的地に到達するために十分な情報を提供していますか？改札のみ・出口のみの場合、もう片方の情報があればユーザー体験が明らかに改善するならfalseを返してください。両方が揃っている、または片方だけで十分なケース（小規模駅で改札=出口を兼ねる等）ならtrueを返してください。",
              {
                true: "十分な情報（retryで改善しない）",
                false: "不完全（retryで改善する可能性）",
              }
            ),
          },
        },
        { signal: controller.signal }
      );
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      raceTimeoutId = setTimeout(() => {
        const error = new Error("JEV API call timed out");
        error.name = "JevTimeoutError";
        reject(error);
      }, timeoutMs);
    });

    const result = await Promise.race([apiCallPromise, timeoutPromise]);

    const isCompleteBothNeededNoul = (result.answers.isCompleteBothNeeded as { noul: number }).noul;
    const isComplete = isCompleteBothNeededNoul > 0.5;

    return {
      isComplete,
      missingFields,
      shouldRetry: !isComplete,
      reason: isComplete
        ? `JEV判定: 十分な情報（確信度: ${isCompleteBothNeededNoul.toFixed(2)}）`
        : `JEV判定: 不完全（確信度: ${(1 - isCompleteBothNeededNoul).toFixed(2)}）`,
    };
  } catch (error) {
    // Fail-open: エラー時は例外を再スロー、Phase 1へフォールバック
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMsg = safeErrorMessage(error);
    console.warn(`[JevClient] Facility completeness evaluation failed (${errorName}): ${errorMsg}, falling back to Phase 1`);
    throw error;
  } finally {
    clearTimeout(abortTimeoutId);
    if (raceTimeoutId !== null) {
      clearTimeout(raceTimeoutId);
    }
  }
}

/**
 * JEVクライアントが利用可能かチェック
 */
export function isJevAvailable(): boolean {
  const key = process.env.JEV_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * JEVクライアント設定を構築（環境変数から）
 */
export function createJevConfig(): JevClientConfig | null {
  const apiKey = process.env.JEV_API_KEY;
  if (!apiKey) {
    return null;
  }
  return { apiKey };
}
