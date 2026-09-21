import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import type { MapsDestinationTarget } from "@/lib/services/google-maps-url";
import { GoogleMapsDestinationLink } from "@/components/result/GoogleMapsDestinationLink";

interface RouteMapsLinkProps {
  facilitiesPromise: Promise<FacilitiesSearchResult>;
  /** place 目的地。駅そのものが目的地の場合は null。 */
  destination: MapsDestinationTarget | null;
}

/**
 * 出口から先はユーザーが地図アプリを使う前提のため、緑カードにも
 * 目的地リンクを出す。改札・出口が全く確認できない(unavailable)場合は
 * サマリー側では出さない(出口カード直下のリンクが担当する)。
 */
export async function RouteMapsLink({ facilitiesPromise, destination }: RouteMapsLinkProps) {
  if (!destination) return null;

  const facilitiesResult = await facilitiesPromise;
  const facility = facilitiesResult.ok ? facilitiesResult.result.arrivalGuide.facility : null;
  if (!facility || facility.state === "unavailable") return null;

  return (
    <GoogleMapsDestinationLink
      destination={destination}
      className="col-span-3 inline-flex items-center justify-center gap-1.5 text-center text-sm font-semibold underline opacity-90"
    />
  );
}
