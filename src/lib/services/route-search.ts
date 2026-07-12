import type {
  AccessibilityCondition,
  RouteConfidenceSummary,
  RouteGuide,
  RouteMode,
  RouteSegment,
} from "@/lib/domain/route";
import type { StationFacility } from "@/lib/domain/station";
import { unavailableConfidence } from "@/lib/domain/confidence";
import type { RouteProviderPort } from "@/lib/integrations/route-provider/RouteProviderPort";
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

export async function searchRouteGuide(
  input: RouteSearchInput,
  deps: RouteSearchDeps
): Promise<RouteSearchResult> {
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

  const arrivalStation = await deps.stationProvider.getStation(
    input.destinationStationId
  );
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

  segments.push({
    type: "transfer",
    from: arrivalStation?.stationName ?? input.destinationStationId,
    to: arrivalStation?.stationName ?? input.destinationStationId,
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
  });

  segments.push({
    type: "exit",
    from: arrivalStation?.stationName ?? input.destinationStationId,
    to: arrivalStation?.stationName ?? input.destinationStationId,
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
  });

  const confidenceSummary: RouteConfidenceSummary = {
    boardingPosition: worstConfidenceLevel(
      segments.filter((s) => s.type === "train").map((s) => s.confidence)
    ),
    transferGuide: worstConfidenceLevel(
      segments.filter((s) => s.type === "transfer").map((s) => s.confidence)
    ),
    gate: gate?.confidence.level ?? "unavailable",
    exit: exit?.confidence.level ?? "unavailable",
    accessibility: input.mode === "accessible" ? elevator?.confidence.level ?? "unavailable" : null,
  };

  const firstBoarding = segments.find(
    (s) => s.type === "train" && s.boardingPosition
  );

  const keyInstructionParts = [
    firstBoarding?.boardingPosition
      ? `${firstBoarding.boardingPosition.carNumber}号車付近に乗車`
      : "乗車位置は確認できません",
    gate ? `${gate.name}` : "改札は確認できません",
    exit ? `${exit.name}へ` : "出口は確認できません",
  ];

  const now = new Date();

  const routeWarnings = chosen.isAiGenerated
    ? [
        "利用路線・所要時間はAI(Web検索結果)による推測です。運行状況の変更等により実際と異なる場合があります。",
      ]
    : [];

  return {
    ok: true,
    route: {
      routeId: `route_${input.originStationId}_${input.destinationStationId}_${input.mode}`,
      mode: input.mode,
      summary: {
        originName: input.originLabel,
        destinationName: input.destinationLabel,
        arrivalStationName: arrivalStation?.stationName ?? input.destinationStationId,
        recommendedExit: exit?.name ?? "確認できません",
        estimatedDurationMinutes: chosen.estimatedDurationMinutes,
        transferCount: chosen.transferCount,
        walkingDistanceMeters: null,
      },
      keyInstruction: { text: keyInstructionParts.join("、") + "。" },
      segments,
      confidenceSummary,
      warnings: routeWarnings,
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
