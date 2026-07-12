import { FixtureStationAdapter } from "./station-provider/FixtureStationAdapter";
import { CompositeStationAdapter } from "./station-provider/CompositeStationAdapter";
import { FixturePlaceAdapter } from "./place-provider/FixturePlaceAdapter";
import { GooglePlaceAdapter } from "./place-provider/GooglePlaceAdapter";
import { FixtureRouteAdapter } from "./route-provider/FixtureRouteAdapter";
import { CompositeRouteAdapter } from "./route-provider/CompositeRouteAdapter";
import type { PlaceProviderPort } from "./place-provider/PlaceProviderPort";
import type { StationProviderPort } from "./station-provider/StationProviderPort";
import type { RouteProviderPort } from "./route-provider/RouteProviderPort";

/**
 * integrations の合成ルート。将来、外部データソースへ差し替える際は
 * ここで Adapter の実体だけ切り替える(呼び出し側は Port にのみ依存)。
 */
// GEMINI_API_KEY 設定時は、fixture に無い改札・出口・号車情報および鉄道経路を
// Gemini の下書き生成(号車等)/ Google Search Grounding(経路)で補う
// (confidence: low 固定。03_STRUCTURE.md「AIを事実の唯一の生成元にしない」に基づく暫定措置)。
const geminiApiKey = process.env.GEMINI_API_KEY;
export const stationProvider: StationProviderPort = geminiApiKey
  ? new CompositeStationAdapter(geminiApiKey)
  : new FixtureStationAdapter();

export const routeProvider: RouteProviderPort = geminiApiKey
  ? new CompositeRouteAdapter(geminiApiKey, stationProvider)
  : new FixtureRouteAdapter();

// GooglePlaceAdapter は最寄り駅解決を stationProvider に委譲するため、
// fixture 収録外の地域を検索すると最寄り駅候補が不正確になる。station データの実データ連携は別タスク。
const googlePlacesApiKey = process.env.GOOGLE_PLACES_API_KEY;
export const placeProvider: PlaceProviderPort = googlePlacesApiKey
  ? new GooglePlaceAdapter(googlePlacesApiKey, stationProvider)
  : new FixturePlaceAdapter();
