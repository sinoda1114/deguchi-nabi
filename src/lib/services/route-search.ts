import type {
  AccessibilityCondition,
  KeyInstruction,
  RouteConfidenceSummary,
  RouteGuide,
  RouteMode,
  RouteSegment,
} from "@/lib/domain/route";
import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { lowConfidence, unavailableConfidence } from "@/lib/domain/confidence";
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
 * 既存の「最初の1件」選定にフォールバックする(fixture外駅のAI生成facility等、
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
 * 格下げする(fixtureで候補が2つしかない駅で、両方とも駅の反対側に
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

  const sorted = sortCandidatesByMode(candidates, input.mode);
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

  const routeWarnings = chosen.isAiGenerated
    ? [
        "利用路線・所要時間はAI(Web検索結果)による推測です。運行状況の変更等により実際と異なる場合があります。",
      ]
    : [];

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
   * computeKeyInstruction が「改札は確認できません、出口は確認できません」
   * ではなく「◯◯側の改札へ、◯◯側の出口へ」と断定的に案内するために使う。
   */
  approximateDirectionLabel: string | null;
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
  const arrivalFacilities = await deps.stationProvider.getFacilities(
    input.destinationStationId
  );

  // 出口→改札の順で選ぶ(逆算)。目的地座標に最も近い出口を選び、その出口の
  // connectedGateId から対応する改札を逆引きする(docs/04_EXIT_SELECTION_DESIGN.md)。
  // 候補集合が不完全(閉世界仮定の誤り)な場合は具体的な出口を名指しせず
  // 方角のみの案内に格下げする(resolveExitRecommendation参照)。到着駅の
  // 中心座標は resolveRouteCandidate で取得済みの candidate から再利用し、
  // ここでの再フェッチは行わない(Promise共有時の重複取得を防ぐため)。
  // exitが確定しなかった場合、gateも「未確定の出口に紐づく改札」を
  // 確信度高く名指しできないため、出口が無ければgateも無しとする。
  // エレベーター・エスカレーターは「存在するかどうか」が重要で方向の影響は
  // 小さいため、引き続き先頭一致で選ぶ(Phase 1のスコープ外)。
  const recommendation = resolveExitRecommendation(
    arrivalFacilities,
    input.destinationCoordinates,
    candidate.arrivalStationCoordinates
  );
  const exit = recommendation.exit;
  const gate = exit ? pickGateForExit(arrivalFacilities, exit) : null;
  const elevator = pickFacility(arrivalFacilities, "elevator");
  const escalator = pickFacility(arrivalFacilities, "escalator");

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
    // approximateタイアでは「改札を出る」こと自体は断定してよい(どの駅にも
    // 改札は必ずある)が、目的地の方角に改札が実在するとまでは断定しない
    // (Codexレビュー指摘: 存在未確認の施設を断定的に案内すると誤誘導になる)。
    // 「現地でご確認ください」等の弱気な表現を繰り返すと機能不全に見え
    // 信頼を損ねるとのフィードバックを受け、不確実性はconfidenceバッジと
    // ページ上部の1回だけの注記(hasApproximateGuidance)で伝える。
    instruction: gate
      ? `${gate.name}へ向かってください。`
      : recommendation.tier === "approximate"
        ? "改札を出てください。"
        : "改札情報を確認できません。",
    confidence: gate
      ? gate.confidence
      : recommendation.tier === "approximate"
        ? lowConfidence("出口が未確定のため、改札も確定できません。")
        : unavailableConfidence("改札情報が不足しています"),
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
    // 出口の実在する方角までは断定しない(その方角に出口があるかは未確認)。
    // 客観的事実として確定している「目的地の方角」のみを案内する。
    instruction: exit
      ? `${exit.name}から出てください。`
      : recommendation.tier === "approximate"
        ? `目的地は${recommendation.destinationDirectionLabel}側です。案内表示に従って出口へ向かってください。`
        : "出口情報を確認できません。",
    confidence: exit
      ? exit.confidence
      : recommendation.tier === "approximate"
        ? lowConfidence(
            `目的地(${recommendation.destinationDirectionLabel}側)に近い出口データが無いため、方角のみの案内です。`
          )
        : unavailableConfidence("出口情報が不足しています"),
    sourceReferences: [],
    warnings: [],
  };

  const recommendedExit =
    exit?.name ??
    (recommendation.tier === "approximate"
      ? `${recommendation.destinationDirectionLabel}側`
      : "確認できません");

  return {
    ok: true,
    result: {
      transferSegment,
      exitSegment,
      recommendedExit,
      gate,
      exit,
      elevator,
      hasApproximateGuidance: recommendation.tier === "approximate",
      approximateDirectionLabel:
        recommendation.tier === "approximate" ? recommendation.destinationDirectionLabel : null,
    },
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

  const keyInstructionParts = [
    firstBoarding?.boardingPosition
      ? `${firstBoarding.boardingPosition.carNumber}号車付近に乗車`
      : "乗車位置は確認できません",
    // 改札は必ず存在するので断定できるが、出口が目的地の方角に実在するかは
    // 未確認のため断定しない(確定しているのは「目的地の方角」のみ)。
    facilities.gate
      ? `${facilities.gate.name}`
      : directionLabel
        ? "改札を出て"
        : "改札は確認できません",
    facilities.exit
      ? `${facilities.exit.name}へ`
      : directionLabel
        ? `${directionLabel}側へ`
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

  const trainSegments = await buildTrainSegments(candidateResult.chosen, deps);
  const facilitiesOutcome = await buildTransferAndExitSegments(
    candidateResult,
    input,
    deps
  );
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
        walkingDistanceMeters: null,
      },
      keyInstruction,
      segments,
      // fixtureの改札・出口データ+AI生成の改札後導線からGuideStep[]を組み立てる
      // (docs/04 §Phase 2.5)。
      arrivalGuide: await buildArrivalGuide(
        facilitiesOutcome.result,
        input.destinationStationId,
        candidateResult.arrivalStationName,
        candidateResult.arrivalStationCoordinates,
        input.mode,
        deps.stationProvider
      ),
      confidenceSummary,
      warnings: candidateResult.routeWarnings,
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ONE_HOUR_MS).toISOString(),
    },
  };
}

function sortCandidatesByMode<
  T extends { transferCount: number; estimatedDurationMinutes: number }
>(candidates: T[], mode: RouteMode): T[] {
  const copy = [...candidates];
  if (mode === "fastest") {
    return copy.sort(
      (a, b) => a.estimatedDurationMinutes - b.estimatedDurationMinutes
    );
  }
  if (mode === "easy") {
    return copy.sort((a, b) => a.transferCount - b.transferCount);
  }
  // accessible: 乗換回数の少なさを優先(段差回避の判断は上位の facility チェックで行う)
  return copy.sort((a, b) => a.transferCount - b.transferCount);
}
