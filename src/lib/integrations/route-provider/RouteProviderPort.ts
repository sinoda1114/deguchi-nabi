import type { Coordinates } from "@/lib/domain/station";

export interface RailSegmentCandidate {
  fromStationId: string;
  toStationId: string;
  line: string;
  direction: string;
  /**
   * ai-route-generation.ts側で検索して確認できた到着番線のラベル文字列
   * (例:"3")、または未確認なら空文字列(AiStationAdapter.getBoardingPositionの
   * isPlainArrivalPlatformLabelで判別する)。
   */
  platformId: string;
  estimatedMinutes: number;
}

export interface RailRouteCandidate {
  originStationId: string;
  arrivalStationId: string;
  segments: RailSegmentCandidate[];
  transferCount: number;
  estimatedDurationMinutes: number;
  /**
   * AIのWeb検索結果を根拠に生成した経路か(true時はUI側で確認不能相当の扱いにする)。
   * fixture廃止(2026-07-20)以降、AiRouteAdapterは常にtrueを設定する
   * (全経路がAI生成のため)。
   */
  isAiGenerated?: boolean;
  /**
   * 候補ごとの到着駅座標(任意項目)。現行の AiRouteAdapter は
   * arrivalStationId === destinationStationId の候補のみを返すため、
   * 実運用では未設定(undefined)のまま。目的地近隣の複数駅を候補として
   * 返す将来のデータソースに備え、route-search.ts の sortCandidatesByMode
   * が徒歩距離(近似)によるタイブレークに使う。未設定の場合はその候補に
   * ついて距離比較をスキップする。
   */
  arrivalStationCoordinates?: Coordinates | null;
}

export interface RouteProviderPort {
  /**
   * destinationHintは目的地施設名(place由来の目的地のみ)。単一呼び出し方式
   * (single-call-navigator.ts)では、経路自体の検索と改札・出口の検索を1回の
   * 検索セッションで行うため、目的地施設名が分かっていれば経路解決の時点から
   * 渡す(2026-07-21追加、任意パラメータのため既存実装は無視してよい)。
   *
   * destinationPlaceCoordinatesは目的地施設自体の実座標(到着駅の中心座標とは
   * 別物)。同名・支店違いの施設が複数存在する場合の曖昧性解消に使う
   * (2026-07-21追加、/ai-review指摘対応)。
   */
  findRailRoutes(
    originStationId: string,
    destinationStationId: string,
    destinationHint?: string | null,
    destinationPlaceCoordinates?: Coordinates | null
  ): Promise<RailRouteCandidate[]>;
}
