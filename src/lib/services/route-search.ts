import type {
  AccessibilityCondition,
  KeyInstruction,
  RouteConfidenceSummary,
  RouteGuide,
  RouteMode,
  RouteSegment,
} from "@/lib/domain/route";
import type { StationFacility } from "@/lib/domain/station";
import { unavailableConfidence } from "@/lib/domain/confidence";
import type {
  RailRouteCandidate,
  RouteProviderPort,
} from "@/lib/integrations/route-provider/RouteProviderPort";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import { worstConfidenceLevel } from "./confidence-engine";

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface RouteSearchInput {
  originStationId: string;
  originLabel: string;
  destinationStationId: string;
  destinationLabel: string;
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
}

/**
 * 到着駅の改札・出口・エレベーター情報を取得し、transfer/exit セグメントを組み立てた結果。
 * TransferExitSegmentList / RouteDiagramSection / ConfidenceSummarySection /
 * RecommendedExitValue / KeyInstructionText が共有する Promise の型として使う。
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

  const gate = pickFacility(arrivalFacilities, "gate");
  const exit = pickFacility(arrivalFacilities, "exit");
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
    instruction: gate
      ? `${gate.name}へ向かってください。`
      : "改札情報を確認できません。",
    confidence: gate
      ? gate.confidence
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
    instruction: exit
      ? `${exit.name}から出てください。`
      : "出口情報を確認できません。",
    confidence: exit
      ? exit.confidence
      : unavailableConfidence("出口情報が不足しています"),
    sourceReferences: [],
    warnings: [],
  };

  return {
    ok: true,
    result: {
      transferSegment,
      exitSegment,
      recommendedExit: exit?.name ?? "確認できません",
      gate,
      exit,
      elevator,
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

  const keyInstructionParts = [
    firstBoarding?.boardingPosition
      ? `${firstBoarding.boardingPosition.carNumber}号車付近に乗車`
      : "乗車位置は確認できません",
    facilities.gate ? `${facilities.gate.name}` : "改札は確認できません",
    facilities.exit ? `${facilities.exit.name}へ` : "出口は確認できません",
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
