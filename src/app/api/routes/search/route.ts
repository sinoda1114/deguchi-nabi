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
// レビュー指摘に基づく)。
//
// ただし到着駅がfixture未収録の場合、経路自体のAI生成(resolveRouteCandidate、
// 最大70秒)と、到着駅の改札・出口AI生成(buildTransferAndExitSegments内の
// getFacilities、最大70秒)は上記の排他制御の対象外で直列実行されるため、
// 合算で最大140秒かかりうる。90秒では不足し実機でFUNCTION_INVOCATION_TIMEOUTを
// 確認した(Issue #68)。当面の緩和策として安全マージンを見て180秒に引き上げる。
// 根本対応(経路生成とfacilities生成の並列化)はIssue #68で追跡する。
export const maxDuration = 180;

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
