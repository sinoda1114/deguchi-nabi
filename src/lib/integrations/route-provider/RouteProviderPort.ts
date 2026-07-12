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
}

export interface RouteProviderPort {
  findRailRoutes(
    originStationId: string,
    destinationStationId: string
  ): Promise<RailRouteCandidate[]>;
}
