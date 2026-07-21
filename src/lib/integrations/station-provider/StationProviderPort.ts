import type {
  BoardingPosition,
  Coordinates,
  Platform,
  Station,
  StationFacility,
} from "@/lib/domain/station";
import type { GuideStep, UnifiedArrivalGuide } from "@/lib/domain/route";

export interface StationProviderPort {
  searchStations(query: string): Promise<Station[]>;
  getStation(stationId: string): Promise<Station | null>;
  getPlatforms(stationId: string): Promise<Platform[]>;
  /**
   * destinationHintは目的地施設名(place由来の目的地のみ)。渡すとAI生成時、
   * 目的地に最も近い改札・出口を優先して検索する(検証実験で目的地名を
   * 検索クエリに含めると精度が大きく向上することを確認済み)。
   */
  getFacilities(stationId: string, destinationHint?: string | null): Promise<StationFacility[]>;
  /**
   * 号車・ドア位置を取得する。platformId は判明していれば渡す(空文字列可)。
   * stationName/line/direction を元にAI下書き生成する。
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
   * 補う任意メソッド(docs/04 §Phase 2.5)。未実装のアダプターは単に呼ばれない
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
  /**
   * 乗車位置・改札・出口・改札後の徒歩ルートを1回の検索セッションで統合生成する
   * 任意メソッド(council議論2026-07-20)。accessibleモード以外で試す。未実装の
   * アダプターは単に呼ばれない(既存のgetArrivalGuideNarrativeStepsと同方針)。
   *
   * originLine/originDirectionは乗車位置(号車・ドア位置)の決定に使う
   * (2026-07-20追加、fix/unified-guide-boarding-and-operator-disambiguation)。
   *
   * originStationIdは2026-07-21追加(単一呼び出し方式、single-call-navigator.ts)。
   * RouteProviderPort.findRailRoutesと同じ生成結果を共有するための共有キャッシュ
   * キー(buildSharedGuideCacheKey)、および出発駅の完全な位置情報(同名駅の
   * 曖昧性解消)取得に使う任意パラメータ(既存実装は無視してよい)。
   */
  getUnifiedArrivalGuide?(
    stationId: string,
    stationName: string,
    operator: string,
    lines: string[],
    originStationName: string,
    originLine: string,
    originDirection: string,
    destinationHint: string | null,
    stationCoordinates: Coordinates | null,
    destinationPlaceCoordinates: Coordinates | null,
    originStationId?: string
  ): Promise<UnifiedArrivalGuide | null>;
}
