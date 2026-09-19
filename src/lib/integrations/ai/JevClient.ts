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
  const timeoutMs = config.timeoutMs ?? 1000;

  // Phase 1: シンプルな判定ロジック（JEV APIの実装が確定次第、本実装へ移行）
  // 現時点では環境変数の存在確認とフォールバック実装
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // TODO: JEV API実装
      // const result = await callJevApi(facility, config.apiKey, controller.signal);
      
      // Phase 1暫定実装: 件数ベースの判定を維持しつつ、構造を整備
      const shouldRetry = facility.state === "unavailable";
      
      clearTimeout(timeoutId);
      return {
        shouldRetry,
        reason: shouldRetry ? "No facility information available" : "Facility information present",
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === "AbortError") {
        console.warn("[JevClient] Retry gate evaluation timed out, falling back to false");
        return { shouldRetry: false, reason: "Timeout fallback" };
      }
      throw error;
    }
  } catch (error) {
    console.warn("[JevClient] Retry gate evaluation failed, falling back to false:", error);
    return { shouldRetry: false, reason: "Error fallback" };
  }
}

/**
 * JEVクライアントが利用可能かチェック
 */
export function isJevAvailable(): boolean {
  return typeof process.env.JEV_API_KEY === "string" && process.env.JEV_API_KEY.length > 0;
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
