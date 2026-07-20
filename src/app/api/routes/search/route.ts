import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { addHistoryEntry } from "@/lib/store/history-repository";
import { resolveAndSearchRoute } from "@/lib/services/route-search-orchestrator";
import type { RouteMode } from "@/lib/domain/route";
import { checkRoutesSearchRateLimit, extractClientIp } from "@/lib/rate-limit/ip-rate-limit";

// 全駅間の経路・乗車位置・改札・出口・徒歩ルートをGemini Search Groundingで
// 検索(検索55秒+抽出15秒を直列実行、最大70秒)するため、プラットフォームの
// デフォルト実行時間上限より長くかかりうる。明示的に確保する。
//
// searchRouteGuide内でresolveRouteCandidate(経路自体のAI生成、最大70秒)→
// buildTransferAndExitSegments(改札・出口・徒歩ルート・乗車位置の統合生成、
// 最大70秒)を直列実行する。2026-07-20(fix/unified-guide-boarding-and-
// operator-disambiguation)で乗車位置を統合生成に統合したため、通常ケース
// (easy/fastestモードかつ統合生成成功)ではbuildTrainSegments自体は追加の
// AI呼び出しをせず、合算最大140秒(経路生成+統合生成)に収まる。
//
// accessibleモードは統合生成を使わないため、buildTrainSegments(号車、
// 最大70秒)とbuildTransferAndExitSegments(改札・出口・エレベーター、
// 最大70秒)を引き続き並列実行し、経路生成+max(両者)で合算最大140秒に収まる。
//
// 統合生成を試みたが出口を確認できなかった場合(accessible以外のモードで
// 統合生成が失敗したケース)のみ、buildTrainSegmentsが独立した乗車位置生成を
// 追加で直列に呼び、経路生成+統合生成+乗車位置生成で最大210秒かかりうる
// (/ai-review指摘、High: 乗車位置と改札・出口の整合性を取るために直列化した
// 副作用で、この経路だけ旧来の140秒上限を超えるようになった)。90秒設定では
// 実機でFUNCTION_INVOCATION_TIMEOUTを確認済み(Issue #68)。210秒の想定に
// 安全マージンを見て240秒に引き上げる。
export const maxDuration = 240;

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
