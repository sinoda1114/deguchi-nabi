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
  const candidates = await deps.routeProvider.findRailRoutes(
    input.originStationId,
    input.destinationStationId
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
          "利用路線・所要時間はAI(Web検索結果)による推測です。運行状況の変更等により実際と異なる場合があります。",
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

/**
 * 選択された経路候補の各鉄道区間について、号車・ドア位置を含む
 * train セグメントを組み立てる(searchRouteGuide の train ループをそのまま抽出)。
 */
export async function buildTrainSegments(
  chosen: RailRouteCandidate,
  deps: Pick<RouteSearchDeps, "stationProvider">
): Promise<RouteSegment[]> {
  const segments: RouteSegment[] = [];

  for (const rail of chosen.segments) {
    const [fromStation, toStation, platforms] = await Promise.all([
      deps.stationProvider.getStation(rail.fromStationId),
      deps.stationProvider.getStation(rail.toStationId),
      deps.stationProvider.getPlatforms(rail.fromStationId),
    ]);
    const platform = platforms.find((p) => p.platformId === rail.platformId);
    const boarding = fromStation
      ? await deps.stationProvider.getBoardingPosition(
          rail.fromStationId,
          fromStation.stationName,
          rail.platformId,
          rail.line,
          rail.direction
        )
      : null;

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
      unified = await deps.stationProvider.getUnifiedArrivalGuide!(
        input.destinationStationId,
        destinationStation.stationName,
        destinationStation.operator,
        destinationStation.lines,
        originStation.stationName,
        destinationHint,
        candidate.arrivalStationCoordinates,
        input.destinationCoordinates
      );
    }
  }

  let exit: StationFacility | null;
  let gate: StationFacility | null;
  let unifiedWalkingSteps: GuideStep[] | null = null;
  let recommendation: ExitRecommendation;

  if (unified && unified.exit) {
    // 統合生成が出口を確認できた場合のみ採用する(/ai-review再指摘、Medium:
    // 出口を確認できなかった部分結果を「確認済み(exact)」として扱ってしまうと、
    // UI・後続処理の確度表示を誤らせる)。
    exit = toUnifiedStationFacility("exit", input.destinationStationId, unified.exit);
    gate = unified.gate
      ? toUnifiedStationFacility("gate", input.destinationStationId, unified.gate)
      : null;
    unifiedWalkingSteps = unified.walkingSteps;
    recommendation = { tier: "exact", exit, destinationDirectionLabel: null };
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
    // 具体的な改札名を確認できていない場合、「改札を出てください」のような
    // 実行可能に見える定型文は表示しない(改札の実在自体は確実でも、目的地の
    // 方角に実在するとまでは確認できていないため)。確認できない旨を明示し、
    // 方角(あれば)は hasApproximateGuidance/approximateDirectionLabel 経由で
    // 「推奨方向」として別途・一度だけ提示する(ユーザーフィードバックに基づき、
    // 未確認の情報を定型文でごまかさない設計に変更)。
    instruction: gate ? `${gate.name}へ向かってください。` : "改札は確認できません。",
    // 改札自体が未確定(実在するかどうか未確認)の場合は、tierに関わらず
    // 常にunavailable(確認不能)として扱う。lowは「実在は確認済みだが検証度が
    // 低い」ケース専用であり、未確認をlowとして扱うと過大な確信度になる。
    confidence: gate ? gate.confidence : unavailableConfidence("改札情報が不足しています"),
    sourceReferences: [],
    warnings: [],
  };

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
    // 具体的な出口名を確認できていない場合、方角(◯◯側)を出口名の代用として
    // 表示しない。方角は hasApproximateGuidance/approximateDirectionLabel
    // 経由で「推奨方向」として別途提示する(ユーザーフィードバックに基づき、
    // 「南側」等を出口名の代わりに表示する設計をやめた)。
    instruction: exit ? `${exit.name}から出てください。` : "出口は確認できません。",
    // 出口自体が未確定(実在するかどうか未確認)の場合は、tierに関わらず
    // 常にunavailable(確認不能)として扱う。
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

  // 号車情報(buildTrainSegments)と改札・出口情報(buildTransferAndExitSegments)は
  // 互いの結果に依存しない(どちらもcandidateResultのみから計算する)ため、
  // 並列実行する(2026-07-20 fixture廃止に伴うPhase 3対策)。順に await すると
  // 経路生成AI(最大70秒)に加えてこの2つ(各最大70秒)が直列に積み重なり、
  // fixture未収録駅への初回アクセスで合計最大210秒かかりFUNCTION_INVOCATION_
  // TIMEOUT(Issue #68)を再発しうる。並列化により140秒圏に短縮する。ストリーミング
  // 表示側(RouteResultBody.tsx)は元々この2つを並列のPromiseとして扱っており、
  // 今回はこのAPI route専用の直列実行のみが残っていた。
  const [trainSegments, facilitiesOutcome] = await Promise.all([
    buildTrainSegments(candidateResult.chosen, deps),
    buildTransferAndExitSegments(candidateResult, input, deps),
  ]);
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
