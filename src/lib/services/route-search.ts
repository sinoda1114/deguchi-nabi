import { randomUUID } from "node:crypto";
import type {
  AccessibilityCondition,
  ArrivalGuide,
  GuideStep,
  KeyInstruction,
  RouteConfidenceSummary,
  RouteGuide,
  RouteMode,
  RouteSegment,
  UnifiedArrivalGuide,
} from "@/lib/domain/route";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import type { Confidence } from "@/lib/domain/confidence";
import { unavailableConfidence } from "@/lib/domain/confidence";
import type {
  RailRouteCandidate,
  RouteProviderPort,
} from "@/lib/integrations/route-provider/RouteProviderPort";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import { haversineMeters } from "@/lib/geo/haversine";
import { bearingDegrees, bearingDifferenceDegrees, compassLabel } from "@/lib/geo/bearing";
import { worstConfidenceLevel } from "./confidence-engine";
import { buildArrivalGuide } from "./arrival-guide";

const ONE_HOUR_MS = 60 * 60 * 1000;
/**
 * 「最寄り候補」と「目的地の方角」の方位差がこの値を超える場合、候補集合が
 * 不完全(閉世界仮定の誤り)である可能性が高いとみなし、出口を名指しせず
 * 方角のみの案内に格下げする。90度(四半円)= 駅の反対側寄りと判断する目安。
 * docs/04_EXIT_SELECTION_DESIGN.md 参照。
 */
const EXIT_BEARING_MISMATCH_THRESHOLD_DEGREES = 90;
/**
 * 目的地がこの距離未満(メートル)で駅に近い場合、方角判定をスキップする。
 * 方位角は2点がごく近いと微小な座標誤差で大きく変動し数学的に不安定なため。
 */
const MIN_BEARING_CHECK_DISTANCE_METERS = 50;
/**
 * 経路候補の所要時間の差がこの分数以下なら「同程度」とみなし、所要時間では
 * 決着させず徒歩距離(近似)による比較に委ねる。乗換検索の所要時間見積もりの
 * 誤差範囲を踏まえた目安値(docs/04_EXIT_SELECTION_DESIGN.md の閾値定数と
 * 同じ考え方: 数値の厳密な最適化ではなく、体感として「大差ない」範囲を定数化する)。
 */
const DURATION_TIE_THRESHOLD_MINUTES = 5;
/**
 * 出発時刻を指定できないこのアプリの検索全般に常時付与する免責文言。
 * このアプリには departureTime に相当する概念が無く、常に「出発時刻未指定」の
 * 通常時経路案内であるため、モードやAI生成有無に関わらず必ず warnings に含める。
 */
export const NO_DEPARTURE_TIME_DISCLAIMER =
  "この案内は通常時の経路情報です。実際の到着番線・最適な乗車位置は、利用日時や運行状況によって異なる場合があります。";
export type { Coordinates };

export interface RouteSearchInput {
  originStationId: string;
  originLabel: string;
  destinationStationId: string;
  destinationLabel: string;
  /**
   * 目的地(place由来)の座標。目的地に応じた出口選定(docs/04_EXIT_SELECTION_DESIGN.md)
   * に使う。目的地が駅そのもの(station由来)の場合は座標を持たないため null。
   */
  destinationCoordinates: Coordinates | null;
  mode: RouteMode;
  accessibility: AccessibilityCondition;
}

export interface RouteSearchDeps {
  routeProvider: RouteProviderPort;
  stationProvider: StationProviderPort;
}

export type RouteSearchResult =
  | { ok: true; route: RouteGuide }
  | { ok: false; reason: string };

function pickFacility(
  facilities: StationFacility[],
  type: StationFacility["facilityType"]
): StationFacility | null {
  return facilities.find((f) => f.facilityType === type) ?? null;
}

/**
 * 目的地座標に最も近い facility を選ぶ。座標が無い(destinationCoordinates が
 * null)、または該当種別のどの facility も coordinates を持たない場合は、
 * 既存の「最初の1件」選定にフォールバックする(AI生成facility等、
 * 座標が未整備なデータでも従来通り動作させるため)。
 */
function pickNearestFacility(
  facilities: StationFacility[],
  type: StationFacility["facilityType"],
  target: Coordinates | null
): StationFacility | null {
  const candidates = facilities.filter((f) => f.facilityType === type);
  if (candidates.length === 0) return null;
  if (!target) return candidates[0];

  const withCoordinates = candidates.filter((f) => f.coordinates !== null);
  if (withCoordinates.length === 0) return candidates[0];

  return withCoordinates.reduce((nearest, current) => {
    const nearestDistance = haversineMeters(
      target.lat,
      target.lng,
      nearest.coordinates!.lat,
      nearest.coordinates!.lng
    );
    const currentDistance = haversineMeters(
      target.lat,
      target.lng,
      current.coordinates!.lat,
      current.coordinates!.lng
    );
    return currentDistance < nearestDistance ? current : nearest;
  });
}

/**
 * 選定済みの出口(exit)から、その connectedGateId が指す改札を逆引きする。
 * リンクが無い、または対応する改札が見つからない場合は、駅の改札一覧の
 * 最初の1件にフォールバックする(座標が近くても実際には連絡していない
 * 改札を誤って連結と見なさないよう、推測ではなく明示リンクのみを使う。
 * docs/04_EXIT_SELECTION_DESIGN.md 4章 参照)。
 */
function pickGateForExit(
  facilities: StationFacility[],
  exit: StationFacility | null
): StationFacility | null {
  if (exit?.connectedGateId) {
    // facilityType !== "gate" のデータへ誤ってリンクされていた場合、
    // それを改札として案内してしまわないよう型も確認する。
    const linkedGate = facilities.find(
      (f) => f.facilityId === exit.connectedGateId && f.facilityType === "gate"
    );
    if (linkedGate) return linkedGate;
  }
  return pickFacility(facilities, "gate");
}

/**
 * 統合生成(unified-arrival-guide-generation.ts)が返すgate/exitを、既存の
 * StationFacility型へ変換する。座標を持たない(coordinates: null)ため、
 * この関数の戻り値を既存のresolveExitRecommendation(座標ベース選定)には
 * 通さず、直接transferSegment/exitSegmentの構築に使う。
 */
function toUnifiedStationFacility(
  facilityType: "gate" | "exit",
  stationId: string,
  facility: { name: string; confidence: StationFacility["confidence"] }
): StationFacility {
  return {
    facilityId: randomUUID(),
    stationId,
    facilityType,
    name: facility.name,
    level: "",
    accessible: false,
    coordinates: null,
    connectedGateId: null,
    confidence: facility.confidence,
    verifiedAt: null,
    provenance: "ai_inferred",
  };
}

export type ExitRecommendationTier = "exact" | "approximate" | "unavailable";

export interface ExitRecommendation {
  tier: ExitRecommendationTier;
  exit: StationFacility | null;
  /** tier が approximate の場合のみ、目的地の方角(8方位ラベル)。 */
  destinationDirectionLabel: string | null;
}

/**
 * 目的地座標・駅中心座標から出口の推薦確度を判定する。
 *
 * 候補出口が座標を持っていても、そのうちの「最寄り」が目的地の方角と
 * 大きくずれている場合、候補集合そのものが不完全(閉世界仮定の誤り)である
 * 可能性が高い。この場合は具体的な出口を名指しせず、方角のみの案内に
 * 格下げする(候補が2つしかない駅で、両方とも駅の反対側に
 * 偏っているケース等)。docs/04_EXIT_SELECTION_DESIGN.md 参照。
 */
function resolveExitRecommendation(
  facilities: StationFacility[],
  destinationCoordinates: Coordinates | null,
  stationCenter: Coordinates | null
): ExitRecommendation {
  const candidates = facilities.filter((f) => f.facilityType === "exit");
  if (candidates.length === 0) {
    return { tier: "unavailable", exit: null, destinationDirectionLabel: null };
  }

  // 目的地が駅そのもの(destinationCoordinatesが無い)場合は方角の概念が
  // 不要なため、従来通りの選定(座標があれば最近傍、無ければ先頭一致)を行う。
  if (!destinationCoordinates) {
    return {
      tier: "exact",
      exit: pickNearestFacility(facilities, "exit", null),
      destinationDirectionLabel: null,
    };
  }

  // 目的地座標はあるが駅中心座標が不明で方角を判定できない場合、先頭一致で
  // 断定すると閉世界仮定の誤りを再導入してしまう(取得失敗時ほど確信度を
  // 下げるべきという原則に反する)ため、出口を名指しせず確認不能として扱う。
  if (!stationCenter) {
    return { tier: "unavailable", exit: null, destinationDirectionLabel: null };
  }

  const distanceToDestinationMeters = haversineMeters(
    stationCenter.lat,
    stationCenter.lng,
    destinationCoordinates.lat,
    destinationCoordinates.lng
  );
  // 目的地が駅からごく近い場合、方角は数学的に不安定(微小な座標誤差で
  // 大きく変動する)ため方角チェックをスキップし、座標ベースの通常の
  // 最近傍選定に委ねる。
  if (distanceToDestinationMeters < MIN_BEARING_CHECK_DISTANCE_METERS) {
    return {
      tier: "exact",
      exit: pickNearestFacility(facilities, "exit", destinationCoordinates),
      destinationDirectionLabel: null,
    };
  }

  const targetBearing = bearingDegrees(
    stationCenter.lat,
    stationCenter.lng,
    destinationCoordinates.lat,
    destinationCoordinates.lng
  );
  const destinationDirectionLabel = compassLabel(targetBearing);

  const withCoordinates = candidates.filter((f) => f.coordinates !== null);
  if (withCoordinates.length === 0) {
    // 座標を持つ候補が一つも無い(AI生成facility等)場合、先頭一致で
    // 断定すると方角を無視した誤案内になりうるため、方角のみに格下げする。
    return { tier: "approximate", exit: null, destinationDirectionLabel };
  }

  const nearest = pickNearestFacility(facilities, "exit", destinationCoordinates)!;
  const nearestBearing = bearingDegrees(
    stationCenter.lat,
    stationCenter.lng,
    nearest.coordinates!.lat,
    nearest.coordinates!.lng
  );
  const bearingDiff = bearingDifferenceDegrees(targetBearing, nearestBearing);

  if (bearingDiff > EXIT_BEARING_MISMATCH_THRESHOLD_DEGREES) {
    return { tier: "approximate", exit: null, destinationDirectionLabel };
  }

  return { tier: "exact", exit: nearest, destinationDirectionLabel: null };
}

/**
 * 経路候補の選定結果。ストリーミング表示では、これが確定した時点で
 * ヘッダー・出発地/目的地・所要時間等をすぐに描画できる
 * (号車・改札・出口の解決を待つ必要がない)。
 */
export interface RouteCandidateResult {
  ok: true;
  routeId: string;
  mode: RouteMode;
  originName: string;
  destinationName: string;
  arrivalStationName: string;
  /**
   * 到着駅の中心座標。出口の方角判定(resolveExitRecommendation)に使う。
   * resolveRouteCandidate で既に取得済みの arrivalStation から作るため、
   * buildTransferAndExitSegments 側での再フェッチを避けられる。
   */
  arrivalStationCoordinates: Coordinates | null;
  estimatedDurationMinutes: number;
  transferCount: number;
  routeWarnings: string[];
  chosen: RailRouteCandidate;
}

export type ResolveRouteCandidateResult =
  | RouteCandidateResult
  | { ok: false; reason: string };

/**
 * 経路候補を取得し、モードに応じて最適な候補を選ぶ。
 * (searchRouteGuide の先頭部分をそのまま抽出したもの)
 */
export async function resolveRouteCandidate(
  input: RouteSearchInput,
  deps: RouteSearchDeps
): Promise<ResolveRouteCandidateResult> {
  // 単一呼び出し方式(single-call-navigator.ts)では、目的地施設名が分かって
  // いれば経路解決の時点から渡し、改札・出口の検索(buildTransferAndExit
  // Segments側のgetUnifiedArrivalGuide呼び出し)と同じ1回の生成結果を共有する
  // (AiRouteAdapter・single-call-navigator.tsのJSDoc参照)。旧DESTINATION_HINT_
  // ENABLEDフラグは、目的地名を絞り込みクエリに使う旧方式(getFacilities)で
  // 精度が悪化した問題への止血だったが、単一呼び出し方式は目的地名を
  // 検索対象そのもの(ユーザー入力)として扱う設計のため、そのフラグの対象外とする。
  const destinationHintForRoute = input.destinationCoordinates ? input.destinationLabel : null;
  const candidates = await deps.routeProvider.findRailRoutes(
    input.originStationId,
    input.destinationStationId,
    destinationHintForRoute,
    input.destinationCoordinates
  );

  if (candidates.length === 0) {
    return {
      ok: false,
      reason:
        "この区間の鉄道経路情報が確認できません。駅名や目的地を見直してください。",
    };
  }

  const sorted = sortCandidatesByMode(
    candidates,
    input.mode,
    input.destinationCoordinates
  );
  const chosen = sorted[0];

  if (input.mode === "accessible" && chosen.isAiGenerated) {
    return {
      ok: false,
      reason:
        "バリアフリー経路を確認できません。この区間の経路はAIによる推測のみで、段差やエレベーターの有無が未確認のため、安全な案内ができません。駅係員への確認をおすすめします。",
    };
  }

  const arrivalStation = await deps.stationProvider.getStation(
    input.destinationStationId
  );

  // このアプリには出発時刻を指定する概念自体が存在しない(常に「出発時刻未指定」の
  // 検索)ため、NO_DEPARTURE_TIME_DISCLAIMERはモード・AI生成有無に関わらず常に含める。
  // AI生成警告は「この経路情報自体の確からしさ」に関する既存の警告のため、
  // より一般的な免責文言より先に出す(既存テストが routeWarnings[0] に
  // AI警告を期待しているため、順序を変えない)。
  const routeWarnings = [
    ...(chosen.isAiGenerated
      ? [
          "利用路線・所要時間はWeb検索結果による推測です。運行状況の変更等により実際と異なる場合があります。",
        ]
      : []),
    NO_DEPARTURE_TIME_DISCLAIMER,
  ];

  return {
    ok: true,
    routeId: `route_${input.originStationId}_${input.destinationStationId}_${input.mode}`,
    mode: input.mode,
    originName: input.originLabel,
    destinationName: input.destinationLabel,
    arrivalStationName: arrivalStation?.stationName ?? input.destinationStationId,
    arrivalStationCoordinates: arrivalStation
      ? { lat: arrivalStation.latitude, lng: arrivalStation.longitude }
      : null,
    estimatedDurationMinutes: chosen.estimatedDurationMinutes,
    transferCount: chosen.transferCount,
    routeWarnings,
    chosen,
  };
}

export interface UnifiedBoardingPosition {
  carNumber: number;
  doorPosition: string;
  reason: string;
  confidence: Confidence;
}

/**
 * 選択された経路候補の各鉄道区間について、号車・ドア位置を含む
 * train セグメントを組み立てる(searchRouteGuide の train ループをそのまま抽出)。
 *
 * unifiedBoardingPositionは、到着駅直前の区間(toStationIdがchosen.
 * arrivalStationIdと一致する区間)について、統合生成(buildTransferAndExit
 * Segments)がgateを基準に既に決定した乗車位置(2026-07-20追加)。これが
 * 渡された場合、その区間では独立した乗車位置生成(getBoardingPosition)を
 * 呼ばずそのまま採用する。統合生成とは無関係な改札を基準にした号車を
 * 独自に返してしまう不整合(西谷駅→横浜駅の実機検証で確認済み。統合生成が
 * 選んだ改札とは別の改札に近い号車を誤って回答していた)を構造的に防ぐ。
 */
export async function buildTrainSegments(
  chosen: RailRouteCandidate,
  deps: Pick<RouteSearchDeps, "stationProvider">,
  unifiedBoardingPosition: UnifiedBoardingPosition | null = null
): Promise<RouteSegment[]> {
  const segments: RouteSegment[] = [];

  for (const rail of chosen.segments) {
    const [fromStation, toStation, platforms] = await Promise.all([
      deps.stationProvider.getStation(rail.fromStationId),
      deps.stationProvider.getStation(rail.toStationId),
      deps.stationProvider.getPlatforms(rail.fromStationId),
    ]);
    const platform = platforms.find((p) => p.platformId === rail.platformId);
    const isArrivalSegment = rail.toStationId === chosen.arrivalStationId;
    const unifiedForSegment = isArrivalSegment ? unifiedBoardingPosition : null;
    const boarding =
      unifiedForSegment ??
      (fromStation
        ? await deps.stationProvider.getBoardingPosition(
            rail.fromStationId,
            fromStation.stationName,
            rail.platformId,
            rail.line,
            rail.direction
          )
        : null);

    segments.push({
      type: "train",
      from: fromStation?.stationName ?? rail.fromStationId,
      to: toStation?.stationName ?? rail.toStationId,
      line: rail.line,
      direction: rail.direction,
      platform: platform?.platformNumber ?? null,
      boardingPosition: boarding
        ? {
            carNumber: boarding.carNumber,
            doorPosition: boarding.doorPosition,
            reason: boarding.reason,
          }
        : null,
      facilities: [],
      instruction: boarding
        ? `${rail.line}で${boarding.carNumber}号車付近に乗車してください。`
        : `${rail.line}に乗車してください。号車情報は確認できません。`,
      confidence: boarding
        ? boarding.confidence
        : unavailableConfidence("推奨号車の情報が不足しています"),
      sourceReferences: [],
      warnings: [],
    });
  }

  return segments;
}

export interface FacilitiesBuildSuccess {
  transferSegment: RouteSegment;
  exitSegment: RouteSegment;
  recommendedExit: string;
  gate: StationFacility | null;
  exit: StationFacility | null;
  elevator: StationFacility | null;
  /**
   * 出口・改札が方角のみの案内(tier: "approximate")に格下げされたか。
   * ページ上部で1回だけ注記を出すために使う(segment単位では繰り返さない)。
   */
  hasApproximateGuidance: boolean;
  /**
   * hasApproximateGuidanceがtrueの場合のみ、目的地の方角(8方位ラベル)。
   * 改札名・出口名の代わりには使わない、あくまで「推奨方向」として独立に
   * 提示するための値(computeKeyInstruction・UI双方で同じ扱いを徹底する)。
   */
  approximateDirectionLabel: string | null;
  /**
   * gate/exitの解決結果+AI生成の改札後導線から組み立てた詳細ステップ列。
   * buildTransferAndExitSegments内で1度だけ生成し(AI呼び出しの重複防止)、
   * searchRouteGuideはこれを再生成せずそのまま使う。
   */
  arrivalGuide: ArrivalGuide;
  /**
   * 統合生成(gateを基準に決定)が返した乗車位置(2026-07-20追加)。統合生成が
   * 使われなかった/出口を確認できなかった場合はnull。buildTrainSegmentsは
   * これが非nullの区間では独立した乗車位置生成(getBoardingPosition)を
   * 呼ばず、この値をそのまま採用する(gateと矛盾しない号車にするため)。
   */
  unifiedBoardingPosition: UnifiedBoardingPosition | null;
}

/**
 * 到着駅の改札・出口・エレベーター情報を取得し、transfer/exit セグメントを組み立てた結果。
 * RouteDiagramSection / ConfidenceSummarySection / RouteOverviewContent /
 * RouteTimelineDiagramSection / FacilitiesWarningBadges が共有する Promise の型として使う。
 */
export type FacilitiesSearchResult =
  | { ok: true; result: FacilitiesBuildSuccess }
  | { ok: false; reason: string };

/**
 * 到着駅の改札・出口・エレベーター情報から transfer/exit セグメントを組み立てる
 * (searchRouteGuide の到着駅 facilities 解決部分をそのまま抽出)。
 */
export async function buildTransferAndExitSegments(
  candidate: RouteCandidateResult,
  input: RouteSearchInput,
  deps: Pick<RouteSearchDeps, "stationProvider">
): Promise<FacilitiesSearchResult> {
  // 目的地がplace由来(施設等)の場合、施設名を検索ヒントとしてgetFacilitiesへ
  // 渡す設計だったが、本番同一構成でのE2E検証(西谷駅→kawara CAFE&DINING横浜店等)で
  // hint有りの方が駅全体検索より改札・出口の確認精度が悪化する(すべて
  // 「確認できません」になる)ことを確認した。絞り込み型の指示文言("最も近い
  // 改札・出口を優先して調べて")が、既存の保守的ルール("確認できない設備は
  // 創作しない")と相互作用し、目的地との近さを確認できない場合に駅全体の
  // 回答まで抑制してしまうのが原因と推定している(council議論)。
  //
  // 検証ゲート(destination-hint-verification.test.ts)で「hint有り≧hint無し」を
  // 確認できるまで、DESTINATION_HINT_ENABLED環境変数でヒント注入自体を
  // デフォルトOFFにして止血する。フラグOFF時はgetFacilities呼び出し自体が
  // destinationHint=nullになり、AiStationAdapterのキャッシュ照合・
  // レートリミッタも含めてこの機能導入前と完全に同一の挙動になる。
  const destinationHint =
    process.env.DESTINATION_HINT_ENABLED === "1" && input.destinationCoordinates
      ? input.destinationLabel
      : null;

  // 単一呼び出し方式(single-call-navigator.ts、getUnifiedArrivalGuide経由)向けの
  // 目的地ヒントは、上記destinationHintとは別に、DESTINATION_HINT_ENABLEDフラグに
  // 関わらず常に渡す。上記フラグは旧方式(getFacilitiesへのヒント注入)で精度が
  // 悪化した問題への止血であり、単一呼び出し方式は目的地名を検索対象そのもの
  // (ユーザー入力)として扱う別設計のため対象外(resolveRouteCandidateの
  // destinationHintForRouteと同じ理由)。
  //
  // 重要: findRailRoutes(resolveRouteCandidate内)にはdestinationHintForRouteを
  // 渡しているため、ここでフラグ経由のdestinationHint(既定でnull)を使うと、
  // 同じ区間でも2つの呼び出しの目的地ヒントが食い違い、getSharedSingleCall
  // NavigatorGuideのキャッシュキーが一致せずGeminiを2回呼んでしまう
  // (実機レビューで発覚、single-call-navigator.tsのキャッシュ設計が無効化される)。
  const destinationHintForUnifiedGuide = input.destinationCoordinates
    ? input.destinationLabel
    : null;

  // 駅・出口はAI生成facilities一覧が座標を持たないため
  // resolveExitRecommendationの座標ベース選定の対象外になり、常に
  // hasApproximateGuidance(方角のみ)以下に落ちる構造的な限界があった
  // (council議論2026-07-20)。座標マッチングを経由せず改札・出口・徒歩ルートを
  // 直接AIに回答させる統合生成(unified-arrival-guide-generation.ts)を、
  // accessibleモード以外に限って試す(accessibleモードはエレベーター有無の
  // 確定が必須のため、統合生成が取得しないelevator/escalatorを取りに行く
  // 旧方式(getFacilities)を使う)。
  let elevator: StationFacility | null = null;
  let escalator: StationFacility | null = null;

  const canTryUnified =
    input.mode !== "accessible" && Boolean(deps.stationProvider.getUnifiedArrivalGuide);

  let unified: UnifiedArrivalGuide | null = null;
  if (canTryUnified) {
    const [originStation, destinationStation] = await Promise.all([
      deps.stationProvider.getStation(input.originStationId),
      deps.stationProvider.getStation(input.destinationStationId),
    ]);
    if (originStation && destinationStation) {
      // 到着駅に接続する最終区間(乗車位置の決定に必要な線区・方面)。
      // 現行のAI生成経路は常に単一区間だが、将来複数区間になっても
      // 到着駅直前の区間を基準にするのが正しいため最後の要素を使う。
      const arrivalSegment = candidate.chosen.segments[candidate.chosen.segments.length - 1];
      unified = await deps.stationProvider.getUnifiedArrivalGuide!(
        input.destinationStationId,
        destinationStation.stationName,
        destinationStation.operator,
        destinationStation.lines,
        originStation.stationName,
        arrivalSegment?.line ?? "",
        arrivalSegment?.direction ?? "",
        destinationHintForUnifiedGuide,
        candidate.arrivalStationCoordinates,
        input.destinationCoordinates,
        originStation.stationId
      );
    }
  }

  let exit: StationFacility | null;
  let gate: StationFacility | null;
  let unifiedWalkingSteps: GuideStep[] | null = null;
  let recommendation: ExitRecommendation;

  if (unified) {
    // 改札・出口は互いに独立して採否を判定する(2026-07-21実機発覚: 単一呼び出し
    // 方式(single-call-navigator.ts)へ移行後、旧「exitが確認できた場合のみ
    // gateも採用する」ロジックのままだと、改札名だけ確信度高く抽出できていても
    // 出口が同じ応答内でたまたま未確認だった場合にgateごと丸ごと「確認できません」
    // にしてしまう不具合が発生した(西谷駅→kawara CAFE&DINING横浜店で再現:
    // gate="1階改札口（みなみ西口方面）"は抽出できていたのにexitがnullだった
    // ためgate自体もnull化されていた)。旧方式では改札を出口から逆引きする
    // 設計だったため両者を結合する意味があったが、単一呼び出し方式では改札・
    // 出口は同じ検索セッションから独立した事実として抽出されるため、
    // 「存在する情報は必ず出す、隠さない」という既定方針(下記exitSegmentの
    // コメント参照)を改札・出口の組み合わせ判定にも一貫して適用する。
    exit = unified.exit
      ? toUnifiedStationFacility("exit", input.destinationStationId, unified.exit)
      : null;
    gate = unified.gate
      ? toUnifiedStationFacility("gate", input.destinationStationId, unified.gate)
      : null;
    unifiedWalkingSteps = unified.walkingSteps;
    recommendation = exit
      ? { tier: "exact", exit, destinationDirectionLabel: null }
      : { tier: "unavailable", exit: null, destinationDirectionLabel: null };
  } else if (canTryUnified) {
    // 統合生成を試みたが出口を確認できなかった場合、旧方式(getFacilities、
    // AI生成2回)へはフォールバックせず「確認できません」のまま返す
    // (/security-review指摘、Medium: フォールバックすると1リクエストで
    // 統合生成+旧方式の計4回の課金対象AI呼び出しが発生しうる。IPレートリミット
    // はリクエスト数のみをカウントしAIコストを見ていないため、同じ日次予算内で
    // 達成可能なコスト消費が実質倍増してしまう。canGenerateNarrativeと同じ
    // 「1リクエストで2系統のAI呼び出しを重ねない」というコスト濫用対策の
    // 考え方を踏襲する。旧方式にフォールバックしても、座標を持たないAI生成
    // facilityでは同じ理由でほぼ確実に「確認できません」に落ちるため、
    // 追加コストに見合うだけの効果も期待しにくい)。
    exit = null;
    gate = null;
    recommendation = { tier: "unavailable", exit: null, destinationDirectionLabel: null };
  } else {
    const arrivalFacilities = await deps.stationProvider.getFacilities(
      input.destinationStationId,
      destinationHint
    );
    // 出口→改札の順で選ぶ(逆算)。目的地座標に最も近い出口を選び、その出口の
    // connectedGateId から対応する改札を逆引きする(docs/04_EXIT_SELECTION_DESIGN.md)。
    // 候補集合が不完全(閉世界仮定の誤り)な場合は具体的な出口を名指しせず
    // 方角のみの案内に格下げする(resolveExitRecommendation参照)。到着駅の
    // 中心座標は resolveRouteCandidate で取得済みの candidate から再利用し、
    // ここでの再フェッチは行わない(Promise共有時の重複取得を防ぐため)。
    // exitが確定しなかった場合、gateも「未確定の出口に紐づく改札」を
    // 確信度高く名指しできないため、出口が無ければgateも無しとする。
    recommendation = resolveExitRecommendation(
      arrivalFacilities,
      input.destinationCoordinates,
      candidate.arrivalStationCoordinates
    );
    exit = recommendation.exit;
    gate = exit ? pickGateForExit(arrivalFacilities, exit) : null;
    elevator = pickFacility(arrivalFacilities, "elevator");
    escalator = pickFacility(arrivalFacilities, "escalator");
  }

  if (input.mode === "accessible" && !elevator) {
    return {
      ok: false,
      reason:
        "バリアフリー経路を確認できません。駅係員への確認をおすすめします。",
    };
  }

  const accessFacility =
    input.mode === "accessible" ? elevator : escalator ?? elevator;

  const transferSegment: RouteSegment = {
    type: "transfer",
    from: candidate.arrivalStationName,
    to: candidate.arrivalStationName,
    line: null,
    direction: gate ? `${gate.name}方面` : null,
    platform: null,
    boardingPosition: null,
    facilities: accessFacility
      ? [
          {
            facilityType: accessFacility.facilityType,
            name: accessFacility.name,
            confidence: accessFacility.confidence,
          },
        ]
      : [],
    // 改札自体が実在未確認(gate === null)の場合のみ「確認できません」と明示する。
    // gateが実在する場合はconfidenceで隠さず必ず改札名を表示する(隠す設計から、
    // 常に値を出す設計への転換。実機検証でユーザーから「隠す」設計への強い不満が
    // 出たことを受けた再設計)。以前はconfidenceが"high"未満の場合に末尾へ
    // 「未確認情報」の注記を付けていたが、この注記テキスト自体はユーザーから
    // 不要と判断され削除した(値を隠さず表示する方針は維持している)。
    instruction: gate ? `${gate.name}へ向かってください。` : "改札は確認できません。",
    // 改札自体が未確定(実在するかどうか未確認)の場合は、tierに関わらず
    // 常にunavailable(確認不能)として扱う。lowは「実在は確認済みだが検証度が
    // 低い」ケース専用であり、未確認をlowとして扱うと過大な確信度になる。
    confidence: gate ? gate.confidence : unavailableConfidence("改札情報が不足しています"),
    sourceReferences: [],
    warnings: [],
  };

  // exitが実在確認できている(exit !== null)場合は、confidenceで隠さず必ず
  // 出口名を表示する。以前は"high_risk"種別としてconfidence.levelがmedium
  // 未満なら非表示にしていたが、これが原因で改札・出口情報の大半が
  // 「確認できません」表示になり、実機検証でユーザーから強い不満が出た。
  // 第三者レビューの結論(guide-step-visibility.ts参照)を受け、「隠す」のでは
  // なく「存在する情報は必ず出す」設計に転換した。上部サマリー「利用出口」
  // (RouteExitStat.tsx、overview-field.ts経由)・「ルートの流れ」タイムライン
  // (route-timeline-nodes.ts)・このexitSegmentの3箇所とも同じ基準
  // (exit非nullなら表示、confidenceでは隠さない)に揃えている。以前はconfidenceが
  // "high"未満の場合に「未確認情報」の注記も付けていたが、この注記テキスト自体は
  // ユーザーから不要と判断され削除した(値を隠さず表示する方針は維持している)。
  //
  // exit変数自体はnullにしない(以前からの設計を維持): confidenceSummary.exit
  // (computeConfidenceSummary参照)やrecommendedExit/computeKeyInstructionは
  // 「出口自体は実在が確認できたか、その検証度は何か」を表す既存の契約を持つ
  // (gateセグメントのconfidenceコメント参照: lowは「実在は確認済みだが検証度が
  // 低い」ケース専用で、未確認(unavailable)とは意味が異なる)。ここでexitを
  // nullへ書き換えると、実際にはlow confidenceで実在する出口を「出口情報が
  // 不足しています」(unavailable)扱いに格上げしてしまい、confidenceSummary等の
  // 集計値が実態と乖離する。
  const exitSegment: RouteSegment = {
    type: "exit",
    from: candidate.arrivalStationName,
    to: candidate.arrivalStationName,
    line: null,
    direction: null,
    platform: null,
    boardingPosition: null,
    facilities: exit
      ? [
          {
            facilityType: exit.facilityType,
            name: exit.name,
            confidence: exit.confidence,
          },
        ]
      : [],
    // 具体的な出口名を確認できていない場合(exit === null)のみ「確認できません」
    // と明示する。方角(◯◯側)を出口名の代用として表示しない設計は維持する
    // (方角は hasApproximateGuidance/approximateDirectionLabel 経由で
    // 「推奨方向」として別途提示する)。exitが実在する場合はconfidenceが
    // "high"未満でも出口名をそのまま表示する(注記テキストは削除済み)。
    instruction: exit ? `${exit.name}から出てください。` : "出口は確認できません。",
    // 出口自体が未確定(実在するかどうか未確認)の場合は、tierに関わらず
    // 常にunavailable(確認不能)として扱う。exitが実在する場合は、実際の
    // confidenceをそのまま保持する(上記コメント参照。confidenceSummary.exit
    // 等との整合を保つため)。
    confidence: exit ? exit.confidence : unavailableConfidence("出口情報が不足しています"),
    sourceReferences: [],
    warnings: [],
  };

  // 方角(◯◯側)を出口名の代用にしない。実際の出口名を確認できなければ
  // 「確認できません」と明示する。
  const recommendedExit = exit?.name ?? "確認できません";

  // 統合生成使用時はrecommendationを常にtier: "exact"として組み立てているため
  // (上記参照)、この判定は自動的にfalseになる。
  const hasApproximateGuidance = recommendation.tier === "approximate";

  const resultWithoutArrivalGuide: Omit<FacilitiesBuildSuccess, "arrivalGuide"> = {
    transferSegment,
    exitSegment,
    recommendedExit,
    gate,
    exit,
    elevator,
    hasApproximateGuidance,
    approximateDirectionLabel: hasApproximateGuidance ? recommendation.destinationDirectionLabel : null,
    // 統合生成がgateを基準に決めた乗車位置(2026-07-20追加)。buildTrainSegments
    // 側の独立した乗車位置生成(getBoardingPosition)と不整合が起きないよう、
    // これが取れている場合はそちらを優先させる(searchRouteGuide参照)。
    // 判定条件はunified.exitではなくunified.gateにする(2026-07-21修正:
    // 乗車位置は「gateを基準に決めた」ものであり出口の有無とは無関係。
    // 単一呼び出し方式では改札・出口が独立して抽出されるため、旧来の
    // exit依存の判定のままだと出口未確認の場合に乗車位置まで無関係に
    // 捨ててしまっていた)。
    unifiedBoardingPosition: unified && unified.gate ? unified.boardingPosition : null,
  };

  // ここで1度だけ生成する(POST API経由・ストリーミング表示経由のどちらから
  // 呼ばれても、この関数を通る限り必ずarrivalGuideが載る。searchRouteGuideは
  // これを再生成せず結果をそのまま使うことで、AI呼び出しの重複を防ぐ)。
  const arrivalGuide = await buildArrivalGuide(
    resultWithoutArrivalGuide,
    input.destinationStationId,
    candidate.arrivalStationName,
    candidate.arrivalStationCoordinates,
    input.mode,
    Boolean(candidate.chosen.isAiGenerated),
    deps.stationProvider,
    unifiedWalkingSteps
  );

  return {
    ok: true,
    result: { ...resultWithoutArrivalGuide, arrivalGuide },
  };
}

/**
 * 情報単位ごとの confidence をまとめる(searchRouteGuide の集約ロジックをそのまま抽出)。
 */
export function computeConfidenceSummary(
  trainSegments: RouteSegment[],
  facilities: FacilitiesBuildSuccess,
  mode: RouteMode
): RouteConfidenceSummary {
  return {
    boardingPosition: worstConfidenceLevel(
      trainSegments.map((s) => s.confidence)
    ),
    transferGuide: worstConfidenceLevel([facilities.transferSegment.confidence]),
    gate: facilities.gate?.confidence.level ?? "unavailable",
    exit: facilities.exit?.confidence.level ?? "unavailable",
    accessibility:
      mode === "accessible" ? facilities.elevator?.confidence.level ?? "unavailable" : null,
  };
}

/**
 * 見出し用の案内文言を組み立てる(searchRouteGuide の文言組み立てロジックをそのまま抽出)。
 */
export function computeKeyInstruction(
  trainSegments: RouteSegment[],
  facilities: FacilitiesBuildSuccess
): KeyInstruction {
  const firstBoarding = trainSegments.find((s) => s.boardingPosition);

  const directionLabel = facilities.approximateDirectionLabel;

  // 改札・出口は具体的な名称が確認できた場合のみ名指しする。方角
  // (directionLabel)は改札名・出口名の代わりには使わず、出口が未確認の
  // 場合にのみ「推奨方向」として付記する(ユーザーフィードバックに基づき、
  // 「南側」等を出口名の代用にしない設計へ変更)。
  const keyInstructionParts = [
    firstBoarding?.boardingPosition
      ? `${firstBoarding.boardingPosition.carNumber}号車付近に乗車`
      : "乗車位置は確認できません",
    facilities.gate ? `${facilities.gate.name}` : "改札は確認できません",
    facilities.exit
      ? `${facilities.exit.name}へ`
      : directionLabel
        ? `出口は確認できません(推奨方向: ${directionLabel}側)`
        : "出口は確認できません",
  ];

  return { text: keyInstructionParts.join("、") + "。" };
}

/**
 * 経路検索全体をまとめて実行するラッパー。POST API(/api/routes/search)から
 * 引き続き利用される(挙動不変)。ストリーミング表示を行う /routes/result では
 * 代わりに resolveRouteCandidate / buildTrainSegments / buildTransferAndExitSegments を
 * 個別に呼び出す。
 */
export async function searchRouteGuide(
  input: RouteSearchInput,
  deps: RouteSearchDeps
): Promise<RouteSearchResult> {
  const candidateResult = await resolveRouteCandidate(input, deps);
  if (!candidateResult.ok) {
    return candidateResult;
  }

  // accessibleモードは統合生成を使わない(canTryUnified参照)ため、
  // buildTrainSegmentsがunifiedBoardingPositionに依存することは無く、
  // Phase 3(2026-07-20 fixture廃止対策)時点の並列実行を維持できる
  // (経路生成(最大70秒)+ max(号車, 改札出口)(最大70秒)で合算最大140秒)。
  //
  // accessible以外のモードは、buildTransferAndExitSegments(改札・出口・
  // 統合生成)を先に解決し、そのunifiedBoardingPositionをbuildTrainSegments
  // へ渡す(2026-07-20 fix/unified-guide-boarding-and-operator-
  // disambiguation)。統合生成がgateを基準に既に決めた乗車位置がある場合、
  // buildTrainSegments側の独立した乗車位置生成(AI呼び出し)は行わずそのまま
  // 採用するため、直列にしても追加のAI呼び出しは発生しない(西谷駅→横浜駅の
  // ケースで、統合生成が選んだ改札とは無関係な号車を独立生成が返してしまう
  // 不整合を防ぐための変更。実機検証で確認済み)。通常ケース(統合生成成功)
  // では経路生成(最大70秒)+統合生成(最大70秒)の直列で合算最大140秒に収まる。
  // 統合生成を試みたが出口を確認できなかった場合のみ、buildTrainSegmentsが
  // 独立した乗車位置生成を追加で呼び最大210秒かかりうる(/ai-review指摘、
  // High: maxDurationは対策としてこの想定を含めて延長する)。
  let facilitiesOutcome: FacilitiesSearchResult;
  let trainSegments: RouteSegment[];
  if (input.mode === "accessible") {
    [trainSegments, facilitiesOutcome] = await Promise.all([
      buildTrainSegments(candidateResult.chosen, deps),
      buildTransferAndExitSegments(candidateResult, input, deps),
    ]);
  } else {
    facilitiesOutcome = await buildTransferAndExitSegments(candidateResult, input, deps);
    trainSegments = facilitiesOutcome.ok
      ? await buildTrainSegments(
          candidateResult.chosen,
          deps,
          facilitiesOutcome.result.unifiedBoardingPosition
        )
      : [];
  }
  if (!facilitiesOutcome.ok) {
    return facilitiesOutcome;
  }

  const segments: RouteSegment[] = [
    ...trainSegments,
    facilitiesOutcome.result.transferSegment,
    facilitiesOutcome.result.exitSegment,
  ];

  const confidenceSummary = computeConfidenceSummary(
    trainSegments,
    facilitiesOutcome.result,
    input.mode
  );
  const keyInstruction = computeKeyInstruction(trainSegments, facilitiesOutcome.result);

  const now = new Date();

  return {
    ok: true,
    route: {
      routeId: candidateResult.routeId,
      mode: candidateResult.mode,
      summary: {
        originName: candidateResult.originName,
        destinationName: candidateResult.destinationName,
        arrivalStationName: candidateResult.arrivalStationName,
        recommendedExit: facilitiesOutcome.result.recommendedExit,
        estimatedDurationMinutes: candidateResult.estimatedDurationMinutes,
        transferCount: candidateResult.transferCount,
        // 到着駅座標と目的地座標からの直線距離(近似値)。目的地がstation由来で
        // destinationCoordinatesが無い場合はnullのまま(既存の「座標が無ければ
        // 比較・案内をスキップする」パターンに倣う)。
        walkingDistanceMeters: approximateWalkingDistanceMeters(
          candidateResult.arrivalStationCoordinates,
          input.destinationCoordinates
        ),
      },
      keyInstruction,
      segments,
      // buildTransferAndExitSegments内で既に1度だけ生成済み(AI呼び出しの
      // 重複防止のため、ここでは再生成せずそのまま使う)。
      arrivalGuide: facilitiesOutcome.result.arrivalGuide,
      confidenceSummary,
      warnings: candidateResult.routeWarnings,
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ONE_HOUR_MS).toISOString(),
    },
  };
}

/**
 * 到着駅座標と目的地座標からの直線距離(近似値)。実際の徒歩経路(道なり)より
 * 短く見積もられうるため、あくまで候補間の比較用の近似値として扱う
 * (過信させないよう、呼び出し側でも変数名・コメントで明示すること)。
 * どちらかの座標が無い場合は比較不能としてnullを返す
 * (目的地がstation由来でdestinationCoordinatesが無い場合等の既存パターンに倣う)。
 */
function approximateWalkingDistanceMeters(
  arrivalStationCoordinates: Coordinates | null | undefined,
  destinationCoordinates: Coordinates | null
): number | null {
  if (!arrivalStationCoordinates || !destinationCoordinates) return null;
  return haversineMeters(
    arrivalStationCoordinates.lat,
    arrivalStationCoordinates.lng,
    destinationCoordinates.lat,
    destinationCoordinates.lng
  );
}

type RouteCandidateLike = {
  transferCount: number;
  estimatedDurationMinutes: number;
  /**
   * 候補ごとの到着駅座標(任意)。現行のRouteProviderPort実装はいずれも
   * 単一の到着駅のみを候補として返すため通常はundefined。徒歩距離(近似)
   * タイブレークに使い、無ければそのタイブレークをスキップする。
   */
  arrivalStationCoordinates?: Coordinates | null;
};

/**
 * sortByStages の1段分の定義。keyが数値を返す候補群を昇順に並べ、差が
 * tieThreshold以下の連続する候補を「同着グループ」としてまとめ、次の段の
 * 比較に委ねる(tieThreshold=0なら完全一致のみを同着とする)。
 *
 * 注意: 「差がtieThreshold以下なら同着」という関係は推移律を満たさない
 * (A・Bの差が閾値内、B・Cの差も閾値内でも、A・Cの差は閾値を超えうる)。
 * ペアごとの比較関数でこれを直接表現すると Array.prototype.sort の前提
 * (比較関数は推移的であること)を満たさず、入力順序によって結果が変わる
 * 不具合になる(コードレビューで指摘された問題)。sortByStagesは同着判定を
 * 「昇順に並べた後、連続する区間の先頭(その区間内の最小値)を基準にした
 * 差」で行うことでこれを避けている。基準を区間内で固定するため、以降の
 * 判定はその基準からの片方向の差のみになり、常に推移的な結果になる
 * (基準の選び方に依存するグルーピングの粗さは残るが、決定的で安定した
 * 順序が得られることを優先する)。
 */
interface SortStage<T> {
  key: (item: T) => number | null;
  tieThreshold: number;
}

/**
 * 複数の SortStage を優先順位順に適用して並び替える。各段でkeyがnullを
 * 返す候補が1つでもあれば、その段の判定は比較不能としてスキップし
 * (既存の「座標が無ければ比較をスキップする」パターンに倣う)、元の
 * 相対順序を保ったまま次の段に進む。全ての段で同着のまま決着しなかった
 * 候補は、Array.prototype.sortがES2019以降安定ソートであることを利用し、
 * 元の配列順序を維持する。
 */
function sortByStages<T>(items: T[], stages: SortStage<T>[]): T[] {
  if (stages.length === 0 || items.length <= 1) return items;

  const [stage, ...restStages] = stages;
  const keys = items.map(stage.key);
  if (keys.some((k) => k === null)) {
    return sortByStages(items, restStages);
  }
  const numericKeys = keys as number[];

  const indices = items.map((_, i) => i);
  indices.sort((i, j) => numericKeys[i] - numericKeys[j]);

  const result: T[] = [];
  let i = 0;
  while (i < indices.length) {
    // 区間の基準値はその区間で最初に現れる(=最小の)値に固定する。以降は
    // この基準との差だけをtieThresholdと比較するため、区間の分け方が
    // ペアごとの比較に依存せず常に一意に決まる(推移律を満たす)。
    const anchor = numericKeys[indices[i]];
    let j = i + 1;
    while (j < indices.length && numericKeys[indices[j]] - anchor <= stage.tieThreshold) {
      j++;
    }
    const group = indices.slice(i, j).map((idx) => items[idx]);
    result.push(...sortByStages(group, restStages));
    i = j;
  }
  return result;
}

/**
 * 徒歩距離(近似)の比較キーを作る。destinationCoordinatesが無い、または
 * 候補が到着駅座標を持たない場合はnull(比較不能、この段をスキップ)を返す。
 */
function makeWalkingDistanceKey<T extends RouteCandidateLike>(
  destinationCoordinates: Coordinates | null
): (item: T) => number | null {
  return (item) =>
    approximateWalkingDistanceMeters(item.arrivalStationCoordinates, destinationCoordinates);
}

/**
 * 経路候補をモードに応じた多段タイブレークで並び替える。
 * - fastest: 所要時間 → 乗換回数 → 徒歩距離(近似)
 * - easy/accessible: 乗換回数 → 所要時間 → 徒歩距離(近似)
 * 所要時間の段は DURATION_TIE_THRESHOLD_MINUTES 以内の差を「同程度」として
 * 決着させないため、所要時間が同程度なグループ内は実質的に次のタイブレーク
 * (徒歩距離、または乗換回数)で決まる。徒歩距離はarrivalStationCoordinates/
 * destinationCoordinatesのいずれかが無い候補では比較をスキップする。
 */
export function sortCandidatesByMode<T extends RouteCandidateLike>(
  candidates: T[],
  mode: RouteMode,
  destinationCoordinates: Coordinates | null
): T[] {
  const walkingDistanceStage: SortStage<T> = {
    key: makeWalkingDistanceKey<T>(destinationCoordinates),
    tieThreshold: 0,
  };
  const transferCountStage: SortStage<T> = {
    key: (c) => c.transferCount,
    tieThreshold: 0,
  };
  const durationStage: SortStage<T> = {
    key: (c) => c.estimatedDurationMinutes,
    tieThreshold: DURATION_TIE_THRESHOLD_MINUTES,
  };

  if (mode === "fastest") {
    return sortByStages(candidates, [durationStage, transferCountStage, walkingDistanceStage]);
  }

  // easy/accessible: 乗換回数の少なさを優先(段差回避の判断は上位の facility
  // チェックで行う)。乗換回数が同じ場合は所要時間、それも同程度なら
  // 徒歩距離(近似)で決着させる。
  return sortByStages(candidates, [transferCountStage, durationStage, walkingDistanceStage]);
}
