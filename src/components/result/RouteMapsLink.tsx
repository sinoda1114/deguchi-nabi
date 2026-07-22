import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import type { Coordinates } from "@/lib/domain/station";

interface RouteMapsLinkProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  /** 目的地(place由来)の座標。駅そのものが目的地の場合はnull。 */
  destinationCoordinates: Coordinates | null;
}

function buildGoogleMapsUrl(coordinates: Coordinates): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coordinates.lat},${coordinates.lng}`;
}

/**
 * 出口から先はユーザーが地図アプリを使う前提(single-call-navigator.tsの
 * 「案内範囲」の設計方針と同じ)のため、出口を出た後にすぐGoogle Mapsを
 * 開けるリンクを提供する。改札・出口が全く確認できない(unavailable)場合は
 * 目的地までの導線自体が不明なため表示しない。目的地座標が無い場合
 * (目的地が駅そのもの)も表示しない。
 *
 * originパラメータは意図的に指定しない(/ai-review指摘、Codex: 出発地を
 * 誤って断定するとかえって誤誘導になりうる。origin未指定ならGoogle Maps側で
 * 端末の現在地を起点にでき、実際に出口を出た直後に開く想定利用と自然に
 * 合致する)。文言も「ルートを見る」ではなく「目的地を開く」とし、
 * 特定の出発地からの経路を保証しているように見せない。
 */
export async function RouteMapsLink({ facilitiesPromise, destinationCoordinates }: RouteMapsLinkProps) {
  if (!destinationCoordinates) return null;

  const facilitiesResult = await facilitiesPromise;
  const facility = facilitiesResult.ok ? facilitiesResult.result.arrivalGuide.facility : null;
  if (!facility || facility.state === "unavailable") return null;

  return (
    <a
      href={buildGoogleMapsUrl(destinationCoordinates)}
      target="_blank"
      rel="noopener noreferrer"
      className="col-span-3 text-center text-sm font-semibold underline opacity-90"
    >
      Google Mapsで目的地を開く
    </a>
  );
}
