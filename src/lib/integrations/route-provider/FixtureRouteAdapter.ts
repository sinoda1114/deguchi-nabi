import type {
  RailRouteCandidate,
  RouteProviderPort,
} from "./RouteProviderPort";

const ROUTES: RailRouteCandidate[] = [
  {
    originStationId: "st_nishiya",
    arrivalStationId: "st_shibuya",
    transferCount: 0,
    estimatedDurationMinutes: 42,
    segments: [
      {
        fromStationId: "st_nishiya",
        toStationId: "st_shibuya",
        line: "相鉄新横浜線・東急新横浜線直通",
        direction: "渋谷方面",
        platformId: "pf_nishiya_soutetsu_shin_yokohama",
        estimatedMinutes: 42,
      },
    ],
  },
  {
    originStationId: "st_shinjuku",
    arrivalStationId: "st_shibuya",
    transferCount: 0,
    estimatedDurationMinutes: 7,
    segments: [
      {
        fromStationId: "st_shinjuku",
        toStationId: "st_shibuya",
        line: "JR山手線",
        direction: "渋谷方面",
        platformId: "pf_shinjuku_jr_yamanote",
        estimatedMinutes: 7,
      },
    ],
  },
];

export class FixtureRouteAdapter implements RouteProviderPort {
  async findRailRoutes(originStationId: string, destinationStationId: string) {
    return ROUTES.filter(
      (r) =>
        r.originStationId === originStationId &&
        r.arrivalStationId === destinationStationId
    );
  }
}
