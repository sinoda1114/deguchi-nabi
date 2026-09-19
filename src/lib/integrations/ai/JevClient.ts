/**
 * JEV (TypeSafe System One) クライアント
 * Phase 1: retry gate判定（single-call-navigator.tsのisFacilityUnavailable置換）
 *
 * 環境変数: JEV_API_KEY（必須）
 * フォールバック: 環境変数未設定時は常にfalseを返す（既存挙動維持）
 * タイムアウト: 1秒（判定に時間がかかる場合はフォールバック）
 */

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
 */
export async function evaluateRetryGate(
  facility: FacilityRecommendation<RawNamedFacility>,
  config: JevClientConfig
): Promise<JevRetryGateDecision> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // TODO: JEV API実装（Phase 2で本実装へ移行）
    // NOTE: When implementing, pass controller.signal to enforce timeout:
    // const result = await callJevApi(facility, config.apiKey, controller.signal);
    
    // Phase 1暫定実装: 件数ベースの判定を維持しつつ、構造を整備
    // IMPORTANT: This synchronous logic does not use the timeout mechanism.
    // Timeout handling will activate once an actual async API call is implemented in Phase 2.
    const shouldRetry = facility.state === "unavailable";
    
    return {
      shouldRetry,
      reason: shouldRetry ? "No facility information available" : "Facility information present",
    };
  } catch (error) {
    // Timeout-specific handling: return false to avoid retry loops
    if ((error as Error).name === "AbortError") {
      console.warn("[JevClient] Retry gate evaluation timed out, falling back to false");
      return { shouldRetry: false, reason: "Timeout fallback" };
    }
    // For other errors, rethrow to let caller apply rule-based fallback
    // (isFacilityUnavailable will catch and use facility.state check)
    console.warn("[JevClient] Retry gate evaluation failed:", safeErrorMessage(error));
    throw error;
  } finally {
    clearTimeout(timeoutId);
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
