import type { RailRouteCandidate, RouteProviderPort } from "./RouteProviderPort";
import { FixtureRouteAdapter } from "./FixtureRouteAdapter";
import { generateRailRoute } from "./ai-route-generation";
import { readCollection, writeCollection } from "@/lib/store/json-file-store";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";

const ROUTE_CACHE = "ai-rail-routes";

interface RouteCacheEntry {
  originStationId: string;
  destinationStationId: string;
  route: RailRouteCandidate;
}

function cacheKey(originStationId: string, destinationStationId: string): string {
  return `${originStationId}__${destinationStationId}`;
}

/**
 * FixtureRouteAdapter を優先しつつ、fixture に無い駅間の経路は
 * Gemini の Google Search Grounding で検索の裏付けを取って生成する複合アダプター。
 * 生成に成功した結果のみローカルJSONにキャッシュし、同じ区間への再検索を避ける
 * (生成失敗は一時的なAPI障害の可能性があるため恒久的な「情報なし」として固定しない)。
 *
 * キャッシュ書き込み失敗時もサービスは継続する(CompositeStationAdapterと同方針)。
 */
export class CompositeRouteAdapter implements RouteProviderPort {
  private readonly fixture = new FixtureRouteAdapter();

  constructor(
    private readonly geminiApiKey: string,
    private readonly stationProvider: StationProviderPort
  ) {}

  async findRailRoutes(
    originStationId: string,
    destinationStationId: string
  ): Promise<RailRouteCandidate[]> {
    const fixtureRoutes = await this.fixture.findRailRoutes(
      originStationId,
      destinationStationId
    );
    if (fixtureRoutes.length > 0) return fixtureRoutes;

    const key = cacheKey(originStationId, destinationStationId);
    const cache = readCollection<RouteCacheEntry>(ROUTE_CACHE);
    const cached = cache.find(
      (c) => cacheKey(c.originStationId, c.destinationStationId) === key
    );
    if (cached) return [cached.route];

    const [originStation, destinationStation] = await Promise.all([
      this.stationProvider.getStation(originStationId),
      this.stationProvider.getStation(destinationStationId),
    ]);
    if (!originStation || !destinationStation) return [];

    const generated = await generateRailRoute(this.geminiApiKey, originStation, destinationStation);
    if (!generated) return [];

    try {
      writeCollection(ROUTE_CACHE, [
        ...cache,
        { originStationId, destinationStationId, route: generated },
      ]);
    } catch {
      // キャッシュ保存は最適化にすぎないため、失敗しても生成結果は返す。
    }

    return [generated];
  }
}
