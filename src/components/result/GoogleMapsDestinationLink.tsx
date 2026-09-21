import { MapPin } from "lucide-react";
import type { Coordinates } from "@/lib/domain/station";
import { buildGoogleMapsUrl } from "@/lib/services/google-maps-url";

interface GoogleMapsDestinationLinkProps {
  destinationCoordinates: Coordinates;
  className?: string;
}

/**
 * 出口の先は地図アプリに渡す前提の目的地リンク。
 * 地図ピンを付け、出口ステップの直下でもサマリーでも同じ文言にする。
 */
export function GoogleMapsDestinationLink({
  destinationCoordinates,
  className,
}: GoogleMapsDestinationLinkProps) {
  return (
    <a
      href={buildGoogleMapsUrl(destinationCoordinates)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      <MapPin className="inline-block h-4 w-4 shrink-0" aria-hidden="true" />
      Google Mapsで目的地を開く
    </a>
  );
}
