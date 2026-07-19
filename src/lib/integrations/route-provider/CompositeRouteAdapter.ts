import type { RailRouteCandidate, RouteProviderPort } from "./RouteProviderPort";
import { FixtureRouteAdapter } from "./FixtureRouteAdapter";
import { generateRailRoute } from "./ai-route-generation";
import { getKvCacheStore } from "@/lib/store/kv-cache-store";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";

const ROUTE_CACHE = "ai-rail-routes";
/** 経路キャッシュは施設情報より変化しにくいため長めのTTLとする。 */
const ROUTE_CACHE_TTL_DAYS = 180;

function cacheKey(originStationId: string, destinationStationId: string): string {
  return `${originStationId}__${destinationStationId}`;
}

/**
 * FixtureRouteAdapter を優先しつつ、fixture に無い駅間の経路は
 * Gemini の Google Search Grounding で検索の裏付けを取って生成する複合アダプター。
 * 生成に成功した結果のみ KvCacheStore(Turso本番・ローカルJSONフォールバック)に
 * キャッシュし、同じ区間への再検索を避ける(生成失敗は一時的なAPI障害の可能性が
 * あるため恒久的な「情報なし」として固定しない)。
 *
 * キャッシュの読み書きが失敗しても、KvCacheStore自身が例外を握りつぶし生成結果を
 * 返せる設計になっているため、このクラス側でtry/catchする必要はない
 * (CompositeStationAdapterと同方針)。
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
    const store = getKvCacheStore();
    const cached = await store.get<RailRouteCandidate>(ROUTE_CACHE, key);
    if (cached) return [cached.value];

    const [originStation, destinationStation] = await Promise.all([
      this.stationProvider.getStation(originStationId),
      this.stationProvider.getStation(destinationStationId),
    ]);
    if (!originStation || !destinationStation) return [];

    const generated = await generateRailRoute(this.geminiApiKey, originStation, destinationStation);
    if (!generated) return [];

    await store.set(ROUTE_CACHE, key, generated, { ttlDays: ROUTE_CACHE_TTL_DAYS });

    return [generated];
  }
}
