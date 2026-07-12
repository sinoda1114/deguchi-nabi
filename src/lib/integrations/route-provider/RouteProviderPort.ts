export interface RailSegmentCandidate {
  fromStationId: string;
  toStationId: string;
  line: string;
  direction: string;
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
