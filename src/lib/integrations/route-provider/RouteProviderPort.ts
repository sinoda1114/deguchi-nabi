import type { Coordinates } from "@/lib/domain/station";

export interface RailSegmentCandidate {
  fromStationId: string;
  toStationId: string;
  line: string;
  direction: string;
  /**
   * fixture由来の場合は実在のPlatform.platformId("pf_..."形式)。
   * ai-route-generation.ts由来(AI生成ルート)の場合は、検索で確認できた
   * 到着番線のラベル文字列(例:"3")、または未確認なら空文字列
   * (CompositeStationAdapter.getBoardingPositionのisPlainArrivalPlatformLabelで
   * 両者を判別する)。
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
  /** AIのWeb検索結果を根拠に生成した経路か(true時はUI側で確認不能相当の扱いにする) */
  isAiGenerated?: boolean;
  /**
   * 候補ごとの到着駅座標(任意項目)。現行の FixtureRouteAdapter /
   * CompositeRouteAdapter はいずれも arrivalStationId === destinationStationId
   * の候補のみを返すため、実運用では未設定(undefined)のまま。目的地近隣の
   * 複数駅を候補として返す将来のデータソースに備え、
   * route-search.ts の sortCandidatesByMode が徒歩距離(近似)による
   * タイブレークに使う。未設定の場合はその候補について距離比較をスキップする。
   */
  arrivalStationCoordinates?: Coordinates | null;
}

export interface RouteProviderPort {
  findRailRoutes(
    originStationId: string,
    destinationStationId: string
  ): Promise<RailRouteCandidate[]>;
}
