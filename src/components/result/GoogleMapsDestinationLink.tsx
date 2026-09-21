import { MapPin } from "lucide-react";
import {
  buildGoogleMapsUrl,
  type MapsDestinationTarget,
} from "@/lib/services/google-maps-url";

interface GoogleMapsDestinationLinkProps {
  destination: MapsDestinationTarget;
  className?: string;
}

/**
 * 出口の先は地図アプリに渡す前提の目的地リンク。
 * 店名 / Place ID を優先し、ピンに店名が載るようにする。
 */
export function GoogleMapsDestinationLink({
  destination,
  className,
}: GoogleMapsDestinationLinkProps) {
  const href = buildGoogleMapsUrl(destination);
  if (!href) return null;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      <MapPin className="inline-block h-4 w-4 shrink-0" aria-hidden="true" />
      Google Mapsで目的地を開く
    </a>
  );
}
