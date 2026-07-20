import { AiStationAdapter } from "./station-provider/AiStationAdapter";
import { GooglePlaceAdapter } from "./place-provider/GooglePlaceAdapter";
import { AiRouteAdapter } from "./route-provider/AiRouteAdapter";
import type { PlaceProviderPort } from "./place-provider/PlaceProviderPort";
import type { StationProviderPort } from "./station-provider/StationProviderPort";
import type { RouteProviderPort } from "./route-provider/RouteProviderPort";

/**
 * integrations の合成ルート。将来、外部データソースへ差し替える際は
 * ここで Adapter の実体だけ切り替える(呼び出し側は Port にのみ依存)。
 *
 * fixture(手動確認済みハードコードデータ)は2026-07-20に廃止した
 * (chore/remove-fixtures)。収録3駅・号車データ西谷発1件のみという
 * 中途半端な収録範囲では「fixtureなら100%確実」という前提自体が
 * 既に崩れており、全駅をAI生成(Gemini Search Grounding)に一本化した
 * 方が一貫性がある、というユーザー判断による。GEMINI_API_KEY /
 * GOOGLE_PLACES_API_KEY が未設定の場合、各Adapterのコンストラクタ・
 * メソッド呼び出し時に自然に失敗する(専用のフォールバック先は無い)。
 */
const geminiApiKey = process.env.GEMINI_API_KEY;
export const stationProvider: StationProviderPort = new AiStationAdapter(geminiApiKey ?? "");

export const routeProvider: RouteProviderPort = new AiRouteAdapter(
  geminiApiKey ?? "",
  stationProvider
);

const googlePlacesApiKey = process.env.GOOGLE_PLACES_API_KEY;
export const placeProvider: PlaceProviderPort = new GooglePlaceAdapter(
  googlePlacesApiKey ?? "",
  stationProvider
);
