const COMPASS_LABELS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
const COMPASS_SECTOR_DEGREES = 360 / COMPASS_LABELS.length;

/** 地点1から地点2への方位角(0〜360度、北を0として時計回り)を計算する。 */
export function bearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  const theta = toDeg(Math.atan2(y, x));
  return (theta + 360) % 360;
}

/** 2つの方位角の差(0〜180度、向きを問わない最短角度差)を計算する。 */
export function bearingDifferenceDegrees(bearingA: number, bearingB: number): number {
  const diff = Math.abs(bearingA - bearingB) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** 方位角を8方位の日本語ラベルに変換する。 */
export function compassLabel(bearing: number): string {
  const normalized = ((bearing % 360) + 360) % 360;
  const index = Math.round(normalized / COMPASS_SECTOR_DEGREES) % COMPASS_LABELS.length;
  return COMPASS_LABELS[index];
}
