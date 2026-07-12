import type { OriginChoice } from "@/components/search/OriginField";
import type { SearchCandidate } from "@/lib/services/place-resolution";
import type { Station } from "@/lib/domain/station";

export interface SwapOriginAndDestinationResult {
  newOrigin: OriginChoice;
  newDestination: SearchCandidate;
}

/** 出発地(OriginChoice)を目的地の駅として使えるStationに解決する。 */
async function resolveOriginAsStation(
  origin: OriginChoice,
  homeStation: Station | null,
  fetchStation: (stationId: string) => Promise<Station | null>
): Promise<Station | null> {
  if (origin.type === "home_station") return homeStation;
  return fetchStation(origin.stationId);
}

/** 目的地(SearchCandidate)を出発地として使えるOriginChoiceに解決する。 */
async function resolveDestinationAsOrigin(
  destination: SearchCandidate,
  fetchStation: (stationId: string) => Promise<Station | null>
): Promise<OriginChoice | null> {
  if (destination.kind === "station") {
    return {
      type: "station",
      stationId: destination.station.stationId,
      label: destination.station.stationName,
    };
  }

  // 施設からは出発できないため、最寄り駅候補の先頭を出発駅として採用する。
  const nearestStationId = destination.destination.nearestStationCandidates[0];
  if (!nearestStationId) return null;

  const station = await fetchStation(nearestStationId);
  if (!station) return null;

  return { type: "station", stationId: station.stationId, label: station.stationName };
}

/**
 * 出発地と目的地を入れ替える。
 *
 * 出発地(OriginChoice)は駅ID+ラベルしか持たない軽量な型、目的地(SearchCandidate)は
 * 駅・施設の完全なオブジェクトを持つ型という非対称な設計のため、単純な代入では
 * 入れ替えられない。不足する駅の完全情報は `fetchStation` (通常は
 * `/api/stations/[stationId]` 経由)で補って変換する。
 *
 * 変換の途中で駅情報が解決できない場合は全体としてnullを返す — 呼び出し元は
 * 既存の出発地/目的地の状態を変更せず、エラー表示に留めること
 * (片方だけ入れ替わった中途半端な状態を防ぐため)。
 */
export async function swapOriginAndDestination(
  origin: OriginChoice,
  destination: SearchCandidate,
  homeStation: Station | null,
  fetchStation: (stationId: string) => Promise<Station | null>
): Promise<SwapOriginAndDestinationResult | null> {
  const [originAsStation, newOrigin] = await Promise.all([
    resolveOriginAsStation(origin, homeStation, fetchStation),
    resolveDestinationAsOrigin(destination, fetchStation),
  ]);

  if (!originAsStation || !newOrigin) return null;

  return {
    newOrigin,
    newDestination: { kind: "station", station: originAsStation },
  };
}
