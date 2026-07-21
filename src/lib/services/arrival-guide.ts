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
 *   重ねることになり誤誘導リスクが増す。
 * - 経路自体がAI生成(isRouteAiGenerated)の場合も生成しない: `/api/routes/search`
 *   は未認証・レート制限なしで呼べるため、経路生成AI(検索55秒+抽出15秒)と
 *   本機能のAI生成(同じく最大70秒)が同一リクエストで両方走ると、1リクエスト
 *   あたり2系統の課金対象API呼び出しを確実に誘発でき、コスト濫用・DoSの
 *   実害を広げてしまう(セキュリティレビュー指摘に基づく対応)。
 *
 *   注記(2026-07-20 fixture廃止時点): AiRouteAdapterは全経路でisAiGenerated:
 *   trueを設定するため、この関数は常にfalseを返す(=この旧方式のAI補完は
 *   実質使われなくなった)。改札後導線の補完は現在、経路生成の有無に依らず
 *   統合生成(unified-arrival-guide-generation.ts、buildArrivalGuideの
 *   unifiedWalkingStepsパス)が担う。この関数・getArrivalGuideNarrativeSteps
 *   自体の削除は本タスク(fixture廃止)のスコープ外としたため未対応。
 */
function canGenerateNarrative(
  result: Pick<FacilitiesBuildSuccess, "gate" | "exit">,
  mode: RouteMode,
  isRouteAiGenerated: boolean
): boolean {
  if (mode === "accessible") return false;
  if (isRouteAiGenerated) return false;
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
 * unifiedWalkingStepsが渡された場合(統合生成、council議論2026-07-20)は、
 * 既にgate・exitと同一の検索セッションで一貫して生成された徒歩ルートのため、
 * それをそのまま中間ステップとして使い、canGenerateNarrative()の判定・
 * getArrivalGuideNarrativeStepsの別呼び出しは行わない(「不確かな情報の上に
 * 不確かな情報を重ねる」問題は、同一セッションで一括生成した場合は発生しない)。
 * unifiedWalkingStepsがnull(統合生成未使用/失敗)の場合のみ、従来通り
 * canGenerateNarrative()の条件を満たす場合に限り改札後方向・自由通路・
 * 地下街等の中間ステップをAI生成で補う。
 *
 * 最終的な steps は isGuideStepVisible でフィルタしてから返す。facility種別
 * (ticket_gate/street_exit)・AI生成由来のどちらであっても、表示可否の判定は
 * 常にこの1箇所を経由させ、判定漏れを防ぐ。
 *
 * steps配列の並び順は「改札→出口→徒歩(ナラティブ)ステップ」にしている
 * (2026-07-21、ユーザー指摘に基づく修正)。以前は「改札→徒歩→出口」の順で
 * 組み立てていたが、徒歩ステップ(AIの自由文)自体が「改札を出る」「出口へ
 * 向かう」「目的地に到着」まで一連の流れとして含んでいるため、その末尾
 * ("目的地に到着")の後ろに別枠の出口ノードが表示され、「ルートの流れ」
 * タイムライン(route-timeline-nodes.ts、steps配列の順序をそのまま表示に使う)
 * で「目的地に到着→出口」という物理的にありえない逆転が発生していた
 * (実機確認: 西谷駅→kawara CAFE&DINING横浜店)。出口は改札を出てすぐ近くに
 * あることが多く、その後の徒歩(ナラティブ)ステップは出口を経由した先の
 * 説明として読める方が自然なため、出口を徒歩ステップより前に配置する。
 */
export async function buildArrivalGuide(
  result: Pick<FacilitiesBuildSuccess, "gate" | "exit" | "approximateDirectionLabel">,
  arrivalStationId: string,
  arrivalStationName: string,
  arrivalStationCoordinates: Coordinates | null,
  mode: RouteMode,
  isRouteAiGenerated: boolean,
  stationProvider: Pick<StationProviderPort, "getArrivalGuideNarrativeSteps">,
  unifiedWalkingSteps: GuideStep[] | null = null
): Promise<ArrivalGuide> {
  const steps: GuideStep[] = [];

  if (result.gate) {
    steps.push(facilityStep("ticket_gate", result.gate, `${result.gate.name}を利用してください。`));
  }

  if (result.exit) {
    steps.push(facilityStep("street_exit", result.exit, `${result.exit.name}から地上へ出てください。`));
  }

  if (unifiedWalkingSteps !== null) {
    steps.push(...unifiedWalkingSteps);
  } else if (
    canGenerateNarrative(result, mode, isRouteAiGenerated) &&
    stationProvider.getArrivalGuideNarrativeSteps
  ) {
    const narrativeSteps = await stationProvider.getArrivalGuideNarrativeSteps(
      arrivalStationId,
      arrivalStationName,
      result.gate!.name,
      result.exit!.name,
      arrivalStationCoordinates
    );
    steps.push(...narrativeSteps);
  }

  return {
    steps: steps.filter(isGuideStepVisible),
    destinationDirection: result.approximateDirectionLabel,
  };
}
