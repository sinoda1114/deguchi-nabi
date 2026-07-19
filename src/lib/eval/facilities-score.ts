import type { StationFacility } from "@/lib/domain/station";

/**
 * 改札・出口AI生成の評価ルーブリック(共通スコアリング関数)。
 *
 * destination-hint-verification.test.ts(Grounding版のhint有無比較)と
 * facilities-backend-eval.test.ts(Grounding版 vs Serperパイプライン版比較)の
 * 両方で同一ロジックを使い、評価基準の二重管理を防ぐために切り出した。
 *
 * ペアスコア = S1(有効facility総数) + S2(gate≧1かつexit≧1なら10点) +
 * S3(medium confidenceの件数)。乗換案内の中核であるgate/exitの両方確認を
 * 最も重く評価する。
 */
export function scoreFacilities(facilities: StationFacility[]): number {
  const s1 = facilities.length;
  const hasGate = facilities.some((f) => f.facilityType === "gate");
  const hasExit = facilities.some((f) => f.facilityType === "exit");
  const s2 = hasGate && hasExit ? 10 : 0;
  const s3 = facilities.filter((f) => f.confidence.level === "medium").length;
  return s1 + s2 + s3;
}
