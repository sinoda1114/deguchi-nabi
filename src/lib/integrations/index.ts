import { FixtureStationAdapter } from "./station-provider/FixtureStationAdapter";
import { FixturePlaceAdapter } from "./place-provider/FixturePlaceAdapter";
import { FixtureRouteAdapter } from "./route-provider/FixtureRouteAdapter";

/**
 * integrations の合成ルート。将来、外部データソースへ差し替える際は
 * ここで Adapter の実体だけ切り替える(呼び出し側は Port にのみ依存)。
 */
export const stationProvider = new FixtureStationAdapter();
export const placeProvider = new FixturePlaceAdapter();
export const routeProvider = new FixtureRouteAdapter();
