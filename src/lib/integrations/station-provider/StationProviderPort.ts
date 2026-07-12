import type {
  BoardingPosition,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";

export interface StationProviderPort {
  searchStations(query: string): Promise<Station[]>;
  getStation(stationId: string): Promise<Station | null>;
  getPlatforms(stationId: string): Promise<Platform[]>;
  getFacilities(stationId: string): Promise<StationFacility[]>;
  /**
   * 号車・ドア位置を取得する。platformId は fixture 収録駅で判明していれば渡す
   * (空文字列可)。fixture に一致が無い場合は stationName/line/direction を元に
   * AI下書き生成にフォールバックする(fixture未収録駅の区間でも号車情報を諦めない)。
   */
  getBoardingPosition(
    stationId: string,
    stationName: string,
    platformId: string,
    line: string,
    direction: string
  ): Promise<BoardingPosition | null>;
  nearestStations(
    latitude: number,
    longitude: number,
    limit: number
  ): Promise<Station[]>;
}
