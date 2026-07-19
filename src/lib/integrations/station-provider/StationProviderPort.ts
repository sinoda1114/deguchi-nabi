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
  /**
   * 改札・出口・改札後の徒歩ルートを1回の検索セッションで統合生成する任意メソッド
   * (council議論2026-07-20)。fixtureに改札・出口が無い駅のeasy/fastestモード向け。
   * 未実装のアダプターは単に呼ばれない(既存のgetArrivalGuideNarrativeStepsと
   * 同方針、必須メソッドにはしていない)。
   */
  getUnifiedArrivalGuide?(
    stationId: string,
    stationName: string,
    operator: string,
    lines: string[],
    originStationName: string,
    destinationHint: string | null,
    stationCoordinates: Coordinates | null,
    destinationPlaceCoordinates: Coordinates | null
  ): Promise<UnifiedArrivalGuide | null>;
  /**
   * 指定駅のfixture収録済みfacility一覧を、AI生成を一切呼ばずに返す任意メソッド
   * (council議論2026-07-20)。呼び出し元(route-search.ts)がgetUnifiedArrivalGuide
   * を試すべきかを、既存のgetFacilities(fixtureに無ければAI生成へフォールバック
   * する設計)を呼ばずに判定するために使う — でなければ統合生成を試す前提の分岐
   * でも旧方式のAI生成が先に走ってしまい、1リクエストでAI呼び出しが二重になって
   * しまう(/ai-review指摘、Medium)。fixtureにexitが無い駅かどうかの判定に加え、
   * fixtureにelevator/escalatorだけ収録されている駅(西谷駅等)でその情報を
   * 失わないためにも使う(統合生成はelevator/escalatorを取得しないため。
   * /ai-review再指摘、Medium)。未実装のアダプターの場合、呼び出し元は
   * 空配列(fixture無し)として扱い、安全側(既存のgetFacilities/AI生成に委ねる)
   * に倒す想定。
   */
  getFixtureFacilities?(stationId: string): Promise<StationFacility[]>;
}
