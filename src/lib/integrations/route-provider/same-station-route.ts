/** 鉄道乗車が不要な同一駅到着（出発駅 ID と目的地最寄り駅 ID が一致）向けの路線ラベル。 */
export const ON_STATION_RAIL_LINE_LABEL = "同一駅（乗車不要）";

export function isSameStationRailRoute(
  originStationId: string,
  destinationStationId: string
): boolean {
  return originStationId.length > 0 && originStationId === destinationStationId;
}
