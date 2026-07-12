import type { RouteMode } from "@/lib/domain/route";

/**
 * 結果画面(/routes/result)の出発駅・到着駅を入れ替えた「帰りのルート」URLを組み立てる。
 *
 * destinationStationId は施設(place)が目的地だった場合でも、既にその施設の最寄り駅として
 * 解決済みの駅IDが渡される想定(呼び出し元の page.tsx で resolveOriginDestination 済み)。
 * そのため帰りは常に station→station の経路として組み立てて問題ない
 * (施設からは出発できないため)。
 */
export function buildReturnRouteUrl(
  originStationId: string,
  destinationStationId: string,
  mode: RouteMode
): string {
  const params = new URLSearchParams();
  params.set("originType", "station");
  params.set("originStationId", destinationStationId);
  params.set("destinationType", "station");
  params.set("destinationId", originStationId);
  params.set("mode", mode);

  return `/routes/result?${params.toString()}`;
}
