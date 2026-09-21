import type { Coordinates } from "@/lib/domain/station";

export interface MapsDestinationTarget {
  name?: string | null;
  placeId?: string | null;
  coordinates?: Coordinates | null;
}

function normalizePlaceId(placeId: string): string {
  return placeId.replace(/^places\//, "").trim();
}

/**
 * 目的地を Google Maps で開く URL。
 * Place ID → 店名検索 → 座標のみ、の順。店名があるのに lat,lng だけ渡すと
 * ピンが別建物名になり自信を損なうので、名前があるときは座標オンリーにしない。
 * origin は付けない(端末の現在地を起点にでき、誤った出発地を断定しない)。
 */
export function buildGoogleMapsUrl(target: MapsDestinationTarget): string | null {
  const name = target.name?.trim() ?? "";
  const placeId = target.placeId ? normalizePlaceId(target.placeId) : "";

  if (placeId) {
    const query = name || placeId;
    return (
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` +
      `&query_place_id=${encodeURIComponent(placeId)}`
    );
  }
  if (name) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
  }
  if (target.coordinates) {
    const { lat, lng } = target.coordinates;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  return null;
}
