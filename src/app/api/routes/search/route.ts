import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { addHistoryEntry } from "@/lib/store/history-repository";
import { resolveAndSearchRoute } from "@/lib/services/route-search-orchestrator";
import type { RouteMode } from "@/lib/domain/route";

// fixture未収録駅間はGemini Search Groundingで検索(検索55秒+抽出15秒を直列実行)するため、
// プラットフォームのデフォルト実行時間上限より長くかかりうる。明示的に確保する。
//
// 改札後導線(arrivalGuide)のAI補完も同じ検索+抽出パターン(最大70秒)を使うが、
// arrival-guide.tsのcanGenerateNarrativeが「経路自体がAI生成の場合は生成しない」
// よう排他制御しているため、1リクエストで両方のAI呼び出しが同時に走ることはない
// (未認証・レート制限の無いこのエンドポイントで、1リクエストあたりの課金対象API
// 呼び出し数が積み重なるコスト濫用/DoSリスクを避けるための設計。セキュリティ
// レビュー指摘に基づく)。よって上限はこれまで通り単一呼び出し分で足りる。
export const maxDuration = 90;

const VALID_MODES: RouteMode[] = ["fastest", "easy", "accessible"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const mode: RouteMode = VALID_MODES.includes(body?.mode) ? body.mode : "easy";

  const origin = body?.origin;
  const destination = body?.destination;

  if (
    origin?.type !== "home_station" &&
    !(origin?.type === "station" && typeof origin.stationId === "string") &&
    !(origin?.type === "current_location" && typeof origin.stationId === "string")
  ) {
    return NextResponse.json({ error: "出発地を特定できません" }, { status: 400 });
  }
  if (
    !(destination?.type === "station" && typeof destination.stationId === "string") &&
    !(destination?.type === "place" && typeof destination.placeId === "string")
  ) {
    return NextResponse.json({ error: "目的地を特定できません" }, { status: 400 });
  }

  const sessionUser = await getSessionUser();

  const result = await resolveAndSearchRoute(
    {
      origin:
        origin.type === "home_station"
          ? { type: "home_station" }
          : { type: "station", stationId: origin.stationId },
      destination:
        destination.type === "station"
          ? { type: "station", stationId: destination.stationId }
          : { type: "place", placeId: destination.placeId },
      mode,
      accessibility: body?.accessibility,
    },
    sessionUser
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (sessionUser) {
    addHistoryEntry({
      userId: sessionUser.userId,
      routeGuideId: result.route.routeId,
      originLabel: result.originLabel,
      destinationLabel: result.destinationLabel,
      mode,
      query: {
        originStationId: result.originStationId,
        destinationStationId: result.destinationStationId,
        mode,
      },
    });
  }

  return NextResponse.json(result.route);
}
