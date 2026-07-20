import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { addHistoryEntry } from "@/lib/store/history-repository";
import { resolveAndSearchRoute } from "@/lib/services/route-search-orchestrator";
import type { RouteMode } from "@/lib/domain/route";
import { checkRoutesSearchRateLimit, extractClientIp } from "@/lib/rate-limit/ip-rate-limit";

// 全駅間の経路・乗車位置・改札・出口・徒歩ルートをGemini Search Groundingで
// 検索するため、プラットフォームのデフォルト実行時間上限より長くかかりうる。
// 明示的に確保する。
//
// searchRouteGuide内でresolveRouteCandidate(経路自体のAI生成。GeminiClient.ts
// 経由、検索55秒+抽出15秒=最大70秒)→buildTransferAndExitSegments(改札・出口・
// 徒歩ルート・乗車位置の統合生成。GeminiAiSdkClient.ts経由)を直列実行する。
// 統合生成は2026-07-20(fix/unified-guide-exit-first-derivation)で出口→改札→
// 徒歩→乗車位置の依存関係を明示する指示を追加した結果プロンプトが長くなり、
// 標準の検索タイムアウト(55秒)ではPreview環境の実機検証でTimeoutErrorを確認
// したため、統合生成専用に検索タイムアウトを90秒へ延長した(unified-arrival-
// guide-generation.ts SEARCH_TIMEOUT_MS参照。検索90秒+抽出15秒=最大105秒)。
// 通常ケース(easy/fastestモードかつ統合生成成功)ではbuildTrainSegments自体は
// 追加のAI呼び出しをせず、合算最大175秒(経路生成70秒+統合生成105秒)に収まる。
//
// accessibleモードは統合生成を使わないため、buildTrainSegments(号車。
// GeminiClient.ts経由、最大70秒)とbuildTransferAndExitSegments(改札・出口・
// エレベーター、最大70秒)を引き続き並列実行し、経路生成+max(両者)で合算
// 最大140秒に収まる。
//
// 統合生成を試みたが出口を確認できなかった場合(accessible以外のモードで
// 統合生成が失敗したケース)のみ、buildTrainSegmentsが独立した乗車位置生成
// (GeminiClient.ts経由、最大70秒)を追加で直列に呼び、経路生成(70秒)+
// 統合生成(105秒)+乗車位置生成(70秒)で最大245秒かかりうる。90秒設定では
// 実機でFUNCTION_INVOCATION_TIMEOUTを確認済み(Issue #68)。245秒の想定に
// 安全マージンを見て290秒に引き上げる。
export const maxDuration = 290;

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
