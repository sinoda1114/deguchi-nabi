import type {
  BoardingPosition,
  Coordinates,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";
import type { GuideStep } from "@/lib/domain/route";

export interface StationProviderPort {
  searchStations(query: string): Promise<Station[]>;
  getStation(stationId: string): Promise<Station | null>;
  getPlatforms(stationId: string): Promise<Platform[]>;
  /**
   * destinationHintは目的地施設名(place由来の目的地のみ)。渡すとAI生成
   * フォールバック時、目的地に最も近い改札・出口を優先して検索する
   * (検証実験で目的地名を検索クエリに含めると精度が大きく向上することを確認済み)。
   * fixture収録駅では現状未使用(fixtureデータは既に確定情報のため)。
   */
  getFacilities(stationId: string, destinationHint?: string | null): Promise<StationFacility[]>;
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
  /**
   * 改札から出口までの改札後方向・自由通路・地下街等の詳細導線(GuideStep[])を
   * 補う任意メソッド(docs/04 §Phase 2.5)。fixtureにこの粒度のデータが無い
   * 駅・区間向けのAI生成による補完で、未実装のアダプターは単に呼ばれない
   * (呼び出し側はoptional chainingで安全に呼ぶ想定。既存の全実装・テスト
   * ダブルへの影響を避けるため、必須メソッドにはしていない)。
   */
  getArrivalGuideNarrativeSteps?(
    stationId: string,
    stationName: string,
    gateName: string,
    exitName: string,
    arrivalStationCoordinates?: Coordinates | null
  ): Promise<GuideStep[]>;
}
