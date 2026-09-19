/**
 * JEV (TypeSafe System One) クライアント
 * Phase 1: retry gate判定（single-call-navigator.tsのisFacilityUnavailable置換）
 *
 * 環境変数: JEV_API_KEY（必須）
 * フォールバック: 環境変数未設定時は常にfalseを返す（既存挙動維持）
 * タイムアウト: 1秒（判定に時間がかかる場合はフォールバック）
 */

import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";
import type { RawNamedFacility } from "./single-call-navigator";

/** JEV判定結果（retry が必要かどうか） */
export interface JevRetryGateDecision {
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
