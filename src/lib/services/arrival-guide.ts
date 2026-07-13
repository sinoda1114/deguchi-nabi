import type { FacilitiesBuildSuccess } from "./route-search";
import type { ArrivalGuide, GuideStep, GuideStepType, RouteMode } from "@/lib/domain/route";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import { capConfidenceForProvenance } from "@/lib/domain/confidence";
import { isGuideStepVisible } from "./guide-step-visibility";

/**
 * StationFacility(改札・出口)から1件のGuideStepを組み立てる。provenanceが
 * 未設定のfacilityは、出所不明なデータを誤って高信頼扱いしないよう安全側の
 * "ai_inferred"として扱う(domain/station.tsのコメント参照)。
 */
function facilityStep(type: GuideStepType, facility: StationFacility, instruction: string): GuideStep {
  const provenance = facility.provenance ?? "ai_inferred";
  return {
    type,
    title: facility.name,
    instruction,
    landmarks: [],
    confidence: {
      ...facility.confidence,
      level: capConfidenceForProvenance(facility.confidence.level, provenance),
    },
    provenance,
  };
}

/**
 * gate・exit双方が確定しており、かつ両方とも出所がAI推定(ai_inferred)では
 * ない場合のみ、改札後導線のAI生成を行ってよいと判定する。
 *
 * - accessibleモードでは生成しない: 現状のプロンプトは段差・階段回避を
 *   考慮しておらず、車椅子利用者等に通行不能な導線を案内しかねない
 *   (AIレビュー指摘に基づく安全対応)。
 * - gate/exit自体がAI推定の場合は生成しない: 実在するかも未確認の施設名の
 *   「間」をさらにAIに推測させると、不確かな情報の上に不確かな情報を
 *   重ねることになり誤誘導リスクが増す。加えて、経路生成自体がAI生成の
 *   場合との直列実行でタイムアウトが積み重なるリスクも抑えられる
 *   (検索グラウンディングは1回あたり最大55秒かかるため)。
 */
function canGenerateNarrative(result: FacilitiesBuildSuccess, mode: RouteMode): boolean {
  if (mode === "accessible") return false;
  if (!result.gate || !result.exit) return false;
  const gateProvenance = result.gate.provenance ?? "ai_inferred";
  const exitProvenance = result.exit.provenance ?? "ai_inferred";
  return gateProvenance !== "ai_inferred" && exitProvenance !== "ai_inferred";
}

/**
 * buildTransferAndExitSegments(route-search.ts)が解決した改札・出口から、
 * GuideStep[]を組み立てる。確認できていないgate/exitについては推測で埋めず
 * ステップ自体を生成しない(根拠のない具体性を排除する設計。docs/04 §Phase 2.5)。
 *
 * canGenerateNarrative()の条件を満たす場合のみ、改札後方向・自由通路・
 * 地下街等の中間ステップをAI生成で補う(stationProvider.getArrivalGuideNarrativeSteps、
 * 任意メソッド)。
 *
 * 最終的な steps は isGuideStepVisible でフィルタしてから返す。fixture由来
 * (ticket_gate/street_exit)・AI生成由来のどちらであっても、表示可否の判定は
 * 常にこの1箇所を経由させ、判定漏れを防ぐ。
 */
export async function buildArrivalGuide(
  result: FacilitiesBuildSuccess,
  arrivalStationId: string,
  arrivalStationName: string,
  arrivalStationCoordinates: Coordinates | null,
  mode: RouteMode,
  stationProvider: Pick<StationProviderPort, "getArrivalGuideNarrativeSteps">
): Promise<ArrivalGuide> {
  const steps: GuideStep[] = [];

  if (result.gate) {
    steps.push(facilityStep("ticket_gate", result.gate, `${result.gate.name}を利用してください。`));
  }

  if (canGenerateNarrative(result, mode) && stationProvider.getArrivalGuideNarrativeSteps) {
    const narrativeSteps = await stationProvider.getArrivalGuideNarrativeSteps(
      arrivalStationId,
      arrivalStationName,
      result.gate!.name,
      result.exit!.name,
      arrivalStationCoordinates
    );
    steps.push(...narrativeSteps);
  }

  if (result.exit) {
    steps.push(facilityStep("street_exit", result.exit, `${result.exit.name}から地上へ出てください。`));
  }

  return {
    steps: steps.filter(isGuideStepVisible),
    destinationDirection: result.approximateDirectionLabel,
  };
}
