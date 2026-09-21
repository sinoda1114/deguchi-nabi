import type { Coordinates, Station } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";

export type OriginChoice =
  | { type: "home_station"; label: string }
  | {
      type: "station";
      stationId: string;
      label: string;
      latitude?: number;
      longitude?: number;
    };

export function buildStationOriginChoice(station: Station): OriginChoice {
  return {
    type: "station",
    stationId: station.stationId,
    label: station.stationName,
    latitude: station.latitude,
    longitude: station.longitude,
  };
}

/**
 * 「実効ホーム駅」ボタン(ログイン時は登録駅、未ログイン時はlocalStorageの
 * デフォルト駅)を押した際の OriginChoice を組み立てる。
 *
 * type: "home_station" は、サーバー側 resolveOriginDestination が
 * 「ログインユーザーのDB登録済み最寄り駅(sessionUser.homeStationId)」
 * としてのみ解釈できる値であり、未ログイン時にこれを送ると sessionUser
 * が無いため「最寄り駅が登録されていません」エラーになる。未ログイン時は
 * 具体的な stationId が判明しているため、代わりに type: "station" として
 * 送る(サーバー側はstation型ならログイン状態を問わずそのまま解決できる)。
 */
export function buildHomeStationOriginChoice(
  user: User | null,
  station: Station
): OriginChoice {
  if (user) {
    return { type: "home_station", label: station.stationName };
  }
  return buildStationOriginChoice(station);
}

/**
 * ページロード時(sessionStorageの下書き復元後)に、未ログイン中は決して
 * 送信できない type: "home_station" が origin に残っていないか検査し、
 * 残っていれば安全な形へ補正する。
 *
 * 修正前のバージョンでは未ログイン時も type: "home_station" を下書きに
 * 保存していたため、過去にその状態で保存された下書きは、
 * buildHomeStationOriginChoice を導入した後もページ再訪問のたびに
 * そのまま復元され、「最寄り駅が登録されていません」エラーが再発していた。
 * これはページロードのたびに毎回チェックすることで、既存の壊れた下書きも
 * 自己修復する。
 */
export function repairStaleOriginChoice(
  origin: OriginChoice | null,
  user: User | null,
  defaultStation: Station | null
): OriginChoice | null {
  if (user) return origin;
  if (origin?.type === "home_station") {
    return defaultStation ? buildHomeStationOriginChoice(user, defaultStation) : null;
  }
  if (!origin && defaultStation) {
    return buildHomeStationOriginChoice(user, defaultStation);
  }
  return origin;
}

/**
 * 出発地入力欄に表示する文字列を決定する。
 * home_station選択時は、sessionStorageの下書きに保存された選択時点の
 * ラベル(古い登録駅名の可能性がある)より、常に最新のeffectiveHomeStation
 * (ログイン時はhomeStation props、未ログイン時はlocalStorageのデフォルト駅)
 * を優先する(/settingsで最寄り駅を変更しても表示が追従するように)。
 */
export function resolveOriginInputValue(
  value: OriginChoice | null,
  effectiveHomeStation: Station | null,
  manualQuery: string
): string {
  if (!value) return manualQuery;
  if (value.type === "home_station") return effectiveHomeStation?.stationName ?? value.label;
  return value.label;
}

function coordinatesFromStation(station: Station | null): Coordinates | null {
  if (!station) return null;
  return { lat: station.latitude, lng: station.longitude };
}

function stationCoordinatesOnChoice(
  origin: Extract<OriginChoice, { type: "station" }>
): Coordinates | null {
  const { latitude, longitude } = origin;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { lat: latitude, lng: longitude };
}

/** 目的地検索の位置バイアス。選択中の出発地の座標。無ければバイアスしない。 */
export function originSearchCoordinates(
  origin: OriginChoice | null,
  known: { homeStation: Station | null; localDefaultStation: Station | null }
): Coordinates | null {
  if (!origin) return null;

  switch (origin.type) {
    case "home_station":
      return coordinatesFromStation(known.homeStation);
    case "station": {
      const fromChoice = stationCoordinatesOnChoice(origin);
      if (fromChoice) return fromChoice;
      if (known.homeStation?.stationId === origin.stationId) {
        return coordinatesFromStation(known.homeStation);
      }
      if (known.localDefaultStation?.stationId === origin.stationId) {
        return coordinatesFromStation(known.localDefaultStation);
      }
      return null;
    }
    default: {
      const _exhaustive: never = origin;
      return _exhaustive;
    }
  }
}
