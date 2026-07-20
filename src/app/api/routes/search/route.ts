import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { addHistoryEntry } from "@/lib/store/history-repository";
import { resolveAndSearchRoute } from "@/lib/services/route-search-orchestrator";
import type { RouteMode } from "@/lib/domain/route";
import { checkRoutesSearchRateLimit, extractClientIp } from "@/lib/rate-limit/ip-rate-limit";

// 全駅間の経路・改札・出口・号車情報をGemini Search Groundingで検索
// (検索55秒+抽出15秒を直列実行、最大70秒)するため、プラットフォームの
// デフォルト実行時間上限より長くかかりうる。明示的に確保する。
//
// resolveRouteCandidate(経路自体のAI生成、最大70秒)の後、buildTrainSegments
// (号車情報)とbuildTransferAndExitSegments(改札・出口・統合生成)は互いの
// 結果に依存しないため searchRouteGuide 内で Promise.all により並列実行する
// (2026-07-20 fixture廃止Phase 3、根本対応。旧実装は直列実行で経路生成+
// 号車+改札出口の最大3系統・最大210秒がかかりうる状態で、90秒設定では実機で
// FUNCTION_INVOCATION_TIMEOUTを確認していた。Issue #68)。並列化後は
// 経路生成(最大70秒)+ max(号車, 改札出口)(最大70秒)で合算最大140秒に収まる。
// 安全マージンを見て180秒のまま維持する。
export const maxDuration = 180;

const VALID_MODES: RouteMode[] = ["fastest", "easy", "accessible"];

export async function POST(req: NextRequest) {
  // 未認証かつAI課金が発生するエンドポイントのため、bodyパースの前に
  // IPベースのレートリミットを判定する(Serperクレジット枯渇=アプリ全体停止
  // という懸念に対する防壁。PR4)。
  const ip = extractClientIp(req.headers);
  const rateLimitResult = await checkRoutesSearchRateLimit(ip);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "アクセスが集中しています。しばらく待ってから再度お試しください。" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimitResult.retryAfterSeconds ?? 60) },
      }
    );
  }

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
