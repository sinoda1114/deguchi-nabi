import type { FacilitiesBuildSuccess } from "./route-search";
import type { ArrivalGuide, GuideStep, GuideStepType, RouteMode } from "@/lib/domain/route";
import type { Coordinates } from "@/lib/domain/station";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import { capConfidenceForProvenance } from "@/lib/domain/confidence";
import type { FacilityPair, FacilityRecommendation, NamedFacility } from "@/lib/domain/facility-recommendation";
import { facilityCandidatesOf } from "@/lib/domain/facility-recommendation";
import { combinedFacilityConfidence } from "./confidence-engine";
import { isGuideStepVisible } from "./guide-step-visibility";

/**
 * FacilityRecommendation(改札 or 出口)から1件のGuideStepを組み立てる。
 * confirmed(1件)・alternatives(2〜3件)のいずれも同じ関数で扱う。alternatives
 * の場合はtitleを"A / B"のように全候補名を連結した文字列にする(UI側
 * (overview-field.ts・route-timeline-nodes.ts)はtitleをそのまま表示するだけで
 * 済み、先頭候補だけを暗黙の推奨のように見せてしまうことを構造的に防ぐ)。
 * confidenceは候補群の中で最も慎重な値を代表値として使う(combinedFacility
 * Confidence)。provenanceが未設定のfacilityは、出所不明なデータを誤って
 * 高信頼扱いしないよう安全側の"ai_inferred"として扱う(domain/station.tsの
 * コメントと同じ考え方)。
 */
function buildFacilityGuideStep(
  type: GuideStepType,
  facilityRecommendation: FacilityRecommendation,
  pick: (pair: FacilityPair) => NamedFacility | null,
  confirmedInstructionFor: (name: string) => string,
  alternativesLabel: string
): GuideStep | null {
  const facilities = facilityCandidatesOf(facilityRecommendation, pick);
  if (facilities.length === 0) return null;

  const provenance = facilities[0].provenance ?? "ai_inferred";
  const isAlternatives = facilityRecommendation.state === "alternatives" && facilities.length > 1;
  const title = facilities.map((f) => f.name).join(" / ");
  const combined = combinedFacilityConfidence(facilities.map((f) => f.confidence));

  return {
    type,
    title,
    instruction: isAlternatives
      ? `${alternativesLabel}: ${title}(いずれか。現地の案内表示でご確認ください)。`
      : confirmedInstructionFor(title),
    landmarks: [],
    confidence: { ...combined, level: capConfidenceForProvenance(combined.level, provenance) },
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
  result: Pick<FacilitiesBuildSuccess, "facilityRecommendation">,
  mode: RouteMode,
  isRouteAiGenerated: boolean
): boolean {
  if (mode === "accessible") return false;
  if (isRouteAiGenerated) return false;
  if (result.facilityRecommendation.state !== "confirmed") return false;
  const { gate, exit } = result.facilityRecommendation.pair;
  if (!gate || !exit) return false;
  const gateProvenance = gate.provenance ?? "ai_inferred";
  const exitProvenance = exit.provenance ?? "ai_inferred";
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
  result: Pick<FacilitiesBuildSuccess, "facilityRecommendation" | "approximateDirectionLabel">,
  arrivalStationId: string,
  arrivalStationName: string,
  arrivalStationCoordinates: Coordinates | null,
  mode: RouteMode,
  isRouteAiGenerated: boolean,
  stationProvider: Pick<StationProviderPort, "getArrivalGuideNarrativeSteps">,
  unifiedWalkingSteps: GuideStep[] | null = null
): Promise<ArrivalGuide> {
  const steps: GuideStep[] = [];

  const gateStep = buildFacilityGuideStep(
    "ticket_gate",
    result.facilityRecommendation,
    (pair) => pair.gate,
    (name) => `${name}を利用してください。`,
    "利用できる改札"
  );
  if (gateStep) steps.push(gateStep);

  const exitStep = buildFacilityGuideStep(
    "street_exit",
    result.facilityRecommendation,
    (pair) => pair.exit,
    (name) => `${name}から地上へ出てください。`,
    "利用できる出口"
  );
  if (exitStep) steps.push(exitStep);

  if (unifiedWalkingSteps !== null) {
    steps.push(...unifiedWalkingSteps);
  } else if (
    canGenerateNarrative(result, mode, isRouteAiGenerated) &&
    stationProvider.getArrivalGuideNarrativeSteps &&
    result.facilityRecommendation.state === "confirmed"
  ) {
    const { gate, exit } = result.facilityRecommendation.pair;
    const narrativeSteps = await stationProvider.getArrivalGuideNarrativeSteps(
      arrivalStationId,
      arrivalStationName,
      gate!.name,
      exit!.name,
      arrivalStationCoordinates
    );
    steps.push(...narrativeSteps);
  }

  return {
    steps: steps.filter(isGuideStepVisible),
    destinationDirection: result.approximateDirectionLabel,
    facility: result.facilityRecommendation,
  };
}
