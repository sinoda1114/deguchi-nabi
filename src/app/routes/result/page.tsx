import { Suspense } from "react";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import type { RouteMode } from "@/lib/domain/route";
import { AppHeader } from "@/components/layout/AppHeader";
import { ResultErrorMessage } from "@/components/result/ResultErrorMessage";
import { RouteResultBody } from "@/components/result/RouteResultBody";
import { RouteResultBodySkeleton } from "@/components/result/RouteResultBodySkeleton";
import { checkRoutesSearchRateLimit, extractClientIp } from "@/lib/rate-limit/ip-rate-limit";

// buildTrainSegments/buildTransferAndExitSegments(RouteResultBody内)は
// /api/routes/search と同じGemini Search Groundingパターンを使いうる。
// Suspense配下でストリーミングしていても、Functionはレンダリング完了まで
// 生き続けるため、プラットフォームのデフォルト実行時間上限では打ち切られ、
// ページが「途中で固まる」ように見える。
//
// 通常ケース(easy/fastestモードかつ統合生成成功)は経路自体のAI生成(最大70秒)
// と到着駅の統合生成(改札・出口・乗車位置・徒歩ルート、検索90秒+抽出15秒=
// 最大105秒。2026-07-20 fix/unified-guide-exit-first-derivationで依存関係を
// 明示する指示追加によりプロンプトが長くなり、標準の55秒ではTimeoutErrorを
// 確認したため延長)が直列実行され合算で最大175秒かかりうる。統合生成を
// 試みたが出口を確認できなかった場合のみ、乗車位置の独立生成(最大70秒)が
// 追加で直列に走り最大245秒かかりうる。/api/routes/search/route.ts と
// 同じ理由・同じ上限に揃える(Issue #68)。
export const maxDuration = 290;

const VALID_MODES: RouteMode[] = ["fastest", "easy", "accessible"];

interface ResultPageProps {
  searchParams: Promise<{
    originType?: string;
    originStationId?: string;
    destinationType?: string;
    destinationId?: string;
    mode?: string;
  }>;
}

/**
 * ページ自体は薄い外枠(パラメータの必須チェックとAppHeaderの即時表示)に
 * とどめ、経路名・所要時間・号車・出口の解決(RouteResultBody)はSuspense
 * 配下に委譲する。origin/destinationの解決自体がAI生成を含み数秒〜数十秒
 * かかりうるため、ここをawaitすると検索直後に白い画面(loading.tsx)のまま
 * 長時間止まって見える。Suspense化することで、検索直後から結果画面の
 * レイアウト骨格(RouteResultBodySkeleton)を表示できる
 * (「検索画面が長い」というユーザーフィードバックに基づく)。
 */
export default async function RouteResultPage({ searchParams }: ResultPageProps) {
  const params = await searchParams;
  const user = await getSessionUser();

  const mode: RouteMode = VALID_MODES.includes(params.mode as RouteMode)
    ? (params.mode as RouteMode)
    : "easy";

  if (
    (params.originType !== "home_station" && !params.originStationId) ||
    !params.destinationType ||
    !params.destinationId
  ) {
    // URL自体が不正なため、同じURLに再アクセスしても結果は変わらない(再試行不可能)。
    // このチェックはstationProvider等への問い合わせを伴わず同期的に完結するため、
    // Suspense化せずページ全体のエラー画面をそのまま返してよい。
    return <ErrorScreen user={user} message="検索条件が不足しています。" />;
  }

  // 未認証かつAI課金が発生しうるRSC(RouteResultBody内のAI補完)へ進む前に、
  // IPベースのレートリミットを判定する(/api/routes/search と同じ防壁。PR4)。
  // Suspense配下(RouteResultBody)ではなくここでチェックすることで、
  // 制限超過時はAI呼び出しへ進まずページ全体のエラー画面を返せる。
  const ip = extractClientIp(await headers());
  const rateLimitResult = await checkRoutesSearchRateLimit(ip);
  if (!rateLimitResult.allowed) {
    return (
      <ErrorScreen
        user={user}
        message="アクセスが集中しています。しばらく待ってから再度お試しください。"
      />
    );
  }

  const origin =
    params.originType === "home_station"
      ? ({ type: "home_station" } as const)
      : ({ type: "station", stationId: params.originStationId! } as const);
  const destination =
    params.destinationType === "place"
      ? ({ type: "place", placeId: params.destinationId! } as const)
      : ({ type: "station", stationId: params.destinationId! } as const);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <Suspense fallback={<RouteResultBodySkeleton mode={mode} />}>
        <RouteResultBody origin={origin} destination={destination} mode={mode} user={user} />
      </Suspense>
    </div>
  );
}

interface ErrorScreenProps {
  user: Awaited<ReturnType<typeof getSessionUser>>;
  message: string;
}

function ErrorScreen({ user, message }: ErrorScreenProps) {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <ResultErrorMessage message={message} />
    </div>
  );
}
