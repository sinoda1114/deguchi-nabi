import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { haversineMeters } from "@/lib/geo/haversine";
import { bearingDegrees, bearingDifferenceDegrees, compassLabel } from "@/lib/geo/bearing";

/**
 * 「最寄り候補」と「目的地の方角」の方位差がこの値を超える場合、候補集合が
 * 不完全(閉世界仮定の誤り)である可能性が高いとみなし、出口を名指しせず
 * 方角のみの案内に格下げする。90度(四半円)= 駅の反対側寄りと判断する目安。
 * docs/04_EXIT_SELECTION_DESIGN.md 参照。
 */
export const EXIT_BEARING_MISMATCH_THRESHOLD_DEGREES = 90;
/**
 * 目的地がこの距離未満(メートル)で駅に近い場合、方角判定をスキップする。
 * 方位角は2点がごく近いと微小な座標誤差で大きく変動し数学的に不安定なため。
 */
export const MIN_BEARING_CHECK_DISTANCE_METERS = 50;

export function pickFacility(
  facilities: StationFacility[],
  type: StationFacility["facilityType"]
): StationFacility | null {
  return facilities.find((f) => f.facilityType === type) ?? null;
}

/**
 * 目的地座標に最も近い facility を選ぶ。座標が無い(destinationCoordinates が
 * null)、または該当種別のどの facility も coordinates を持たない場合は、
 * 既存の「最初の1件」選定にフォールバックする(AI生成facility等、
 * 座標が未整備なデータでも従来通り動作させるため)。
 */
export function pickNearestFacility(
  facilities: StationFacility[],
  type: StationFacility["facilityType"],
  target: Coordinates | null
): StationFacility | null {
  const candidates = facilities.filter((f) => f.facilityType === type);
  if (candidates.length === 0) return null;
  if (!target) return candidates[0];

  const withCoordinates = candidates.filter((f) => f.coordinates !== null);
  if (withCoordinates.length === 0) return candidates[0];

  return withCoordinates.reduce((nearest, current) => {
    const nearestDistance = haversineMeters(
      target.lat,
      target.lng,
      nearest.coordinates!.lat,
      nearest.coordinates!.lng
    );
    const currentDistance = haversineMeters(
      target.lat,
      target.lng,
      current.coordinates!.lat,
      current.coordinates!.lng
    );
    return currentDistance < nearestDistance ? current : nearest;
  });
}

/**
 * 選定済みの出口(exit)から、その connectedGateId が指す改札を逆引きする。
 * リンクが無い、または対応する改札が見つからない場合は、駅の改札一覧の
 * 最初の1件にフォールバックする(座標が近くても実際には連絡していない
 * 改札を誤って連結と見なさないよう、推測ではなく明示リンクのみを使う。
 * docs/04_EXIT_SELECTION_DESIGN.md 4章 参照)。
 *
 * 決定的データ層の BothHit 判定では、この先頭改札フォールバックを使わず
 * `linkedGateForExit` のみを採用する(誤ペアを成功扱いしないため)。
 */
export function pickGateForExit(
  facilities: StationFacility[],
  exit: StationFacility | null
): StationFacility | null {
  return linkedGateForExit(facilities, exit) ?? pickFacility(facilities, "gate");
}

/** 明示リンクで繋がる改札のみ。無ければ null(先頭改札へフォールバックしない)。 */
export function linkedGateForExit(
  facilities: StationFacility[],
  exit: StationFacility | null
): StationFacility | null {
  if (!exit?.connectedGateId) return null;
  return (
    facilities.find(
      (f) => f.facilityId === exit.connectedGateId && f.facilityType === "gate"
    ) ?? null
  );
}

export type ExitRecommendationTier = "exact" | "approximate" | "unavailable";

export interface ExitRecommendation {
  tier: ExitRecommendationTier;
  exit: StationFacility | null;
  /** tier が approximate の場合のみ、目的地の方角(8方位ラベル)。 */
  destinationDirectionLabel: string | null;
}

/**
 * 目的地座標・駅中心座標から出口の推薦確度を判定する。
 *
 * 候補出口が座標を持っていても、そのうちの「最寄り」が目的地の方角と
 * 大きくずれている場合、候補集合そのものが不完全(閉世界仮定の誤り)である
 * 可能性が高い。この場合は具体的な出口を名指しせず、方角のみの案内に
 * 格下げする(候補が2つしかない駅で、両方とも駅の反対側に
 * 偏っているケース等)。docs/04_EXIT_SELECTION_DESIGN.md 参照。
 */
export function resolveExitRecommendation(
  facilities: StationFacility[],
  destinationCoordinates: Coordinates | null,
  stationCenter: Coordinates | null
): ExitRecommendation {
  const candidates = facilities.filter((f) => f.facilityType === "exit");
  if (candidates.length === 0) {
    return { tier: "unavailable", exit: null, destinationDirectionLabel: null };
  }

  // 目的地が駅そのもの(destinationCoordinatesが無い)場合は方角の概念が
  // 不要なため、従来通りの選定(座標があれば最近傍、無ければ先頭一致)を行う。
  if (!destinationCoordinates) {
    return {
      tier: "exact",
      exit: pickNearestFacility(facilities, "exit", null),
      destinationDirectionLabel: null,
    };
  }

  // 目的地座標はあるが駅中心座標が不明で方角を判定できない場合、先頭一致で
  // 断定すると閉世界仮定の誤りを再導入してしまう(取得失敗時ほど確信度を
  // 下げるべきという原則に反する)ため、出口を名指しせず確認不能として扱う。
  if (!stationCenter) {
    return { tier: "unavailable", exit: null, destinationDirectionLabel: null };
  }

  const distanceToDestinationMeters = haversineMeters(
    stationCenter.lat,
    stationCenter.lng,
    destinationCoordinates.lat,
    destinationCoordinates.lng
  );
  // 目的地が駅からごく近い場合、方角は数学的に不安定(微小な座標誤差で
  // 大きく変動する)ため方角チェックをスキップし、座標ベースの通常の
  // 最近傍選定に委ねる。
  if (distanceToDestinationMeters < MIN_BEARING_CHECK_DISTANCE_METERS) {
    return {
      tier: "exact",
      exit: pickNearestFacility(facilities, "exit", destinationCoordinates),
      destinationDirectionLabel: null,
    };
  }

  const targetBearing = bearingDegrees(
    stationCenter.lat,
    stationCenter.lng,
    destinationCoordinates.lat,
    destinationCoordinates.lng
  );
  const destinationDirectionLabel = compassLabel(targetBearing);

  const withCoordinates = candidates.filter((f) => f.coordinates !== null);
  if (withCoordinates.length === 0) {
    // 座標を持つ候補が一つも無い(AI生成facility等)場合、先頭一致で
    // 断定すると方角を無視した誤案内になりうるため、方角のみに格下げする。
    return { tier: "approximate", exit: null, destinationDirectionLabel };
  }

  const nearest = pickNearestFacility(facilities, "exit", destinationCoordinates)!;
  const nearestBearing = bearingDegrees(
    stationCenter.lat,
    stationCenter.lng,
    nearest.coordinates!.lat,
    nearest.coordinates!.lng
  );
  const bearingDiff = bearingDifferenceDegrees(targetBearing, nearestBearing);

  if (bearingDiff > EXIT_BEARING_MISMATCH_THRESHOLD_DEGREES) {
    return { tier: "approximate", exit: null, destinationDirectionLabel };
  }

  return { tier: "exact", exit: nearest, destinationDirectionLabel: null };
}
