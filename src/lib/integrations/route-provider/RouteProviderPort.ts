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
}

export interface RouteProviderPort {
  findRailRoutes(
    originStationId: string,
    destinationStationId: string
  ): Promise<RailRouteCandidate[]>;
}
