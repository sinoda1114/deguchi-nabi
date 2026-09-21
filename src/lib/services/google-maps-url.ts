import type { Coordinates } from "@/lib/domain/station";

/**
 * 目的地座標だけを渡す Directions URL。origin は付けない。
 * 端末の現在地を起点にでき、誤った出発地を断定しない。
 */
export function buildGoogleMapsUrl(coordinates: Coordinates): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coordinates.lat},${coordinates.lng}`;
}
