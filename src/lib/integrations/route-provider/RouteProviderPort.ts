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
  findRailRoutes(
    originStationId: string,
    destinationStationId: string
  ): Promise<RailRouteCandidate[]>;
}
