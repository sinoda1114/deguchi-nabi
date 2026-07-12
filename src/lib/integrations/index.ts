import { FixtureStationAdapter } from "./station-provider/FixtureStationAdapter";
import { FixturePlaceAdapter } from "./place-provider/FixturePlaceAdapter";
import { GooglePlaceAdapter } from "./place-provider/GooglePlaceAdapter";
import { FixtureRouteAdapter } from "./route-provider/FixtureRouteAdapter";
import type { PlaceProviderPort } from "./place-provider/PlaceProviderPort";

/**
 * integrations の合成ルート。将来、外部データソースへ差し替える際は
 * ここで Adapter の実体だけ切り替える(呼び出し側は Port にのみ依存)。
 */
export const stationProvider = new FixtureStationAdapter();
export const routeProvider = new FixtureRouteAdapter();

// GooglePlaceAdapter は最寄り駅解決を stationProvider(現状 FixtureStationAdapter)に委譲するため、
// fixture 収録外の地域を検索すると最寄り駅候補が不正確になる。station データの実データ連携は別タスク。
const googlePlacesApiKey = process.env.GOOGLE_PLACES_API_KEY;
export const placeProvider: PlaceProviderPort = googlePlacesApiKey
  ? new GooglePlaceAdapter(googlePlacesApiKey, stationProvider)
  : new FixturePlaceAdapter();
