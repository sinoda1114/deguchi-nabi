import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { addHistoryEntry } from "@/lib/store/history-repository";
import { resolveAndSearchRoute } from "@/lib/services/route-search-orchestrator";
import type { RouteMode } from "@/lib/domain/route";
import { checkRoutesSearchRateLimit, extractClientIp } from "@/lib/rate-limit/ip-rate-limit";

// fixture未収録駅間はGemini Search Groundingで検索(検索55秒+抽出15秒を直列実行)するため、
// プラットフォームのデフォルト実行時間上限より長くかかりうる。明示的に確保する。
//
// 改札後導線(arrivalGuide)の旧方式AI補完(getArrivalGuideNarrativeSteps)も同じ
// 検索+抽出パターン(最大70秒)を使うが、arrival-guide.tsのcanGenerateNarrativeが
// 「経路自体がAI生成の場合は生成しない」よう排他制御しているため、この旧方式と
// 経路生成AIが1リクエストで同時に走ることはない(未認証・レート制限の無い
// このエンドポイントで、1リクエストあたりの課金対象API呼び出し数が積み重なる
// コスト濫用/DoSリスクを避けるための設計。セキュリティレビュー指摘に基づく)。
//
// ただし到着駅がfixture未収録の場合、経路自体のAI生成(resolveRouteCandidate、
// 最大70秒)と、到着駅の改札・出口AI生成(buildTransferAndExitSegments内の
// getFacilitiesまたは統合生成unified-arrival-guide-generation、最大70秒)は
// 上記の排他制御の対象外で直列実行されるため、合算で最大140秒かかりうる。
// 統合生成は2026-07-20(fix/unified-guide-allow-ai-route)以降、経路自体が
// AI生成の場合でも意図的に呼ぶ(fixture外ルートで改札・出口を確認可能にする
// ため。IPレートリミットで総リクエスト数は上限があるためコスト増は許容する
// 判断)。90秒では不足し実機でFUNCTION_INVOCATION_TIMEOUTを確認した
// (Issue #68)。当面の緩和策として安全マージンを見て180秒に引き上げる。
// 根本対応(経路生成とfacilities生成の並列化)はIssue #68で追跡する。
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
