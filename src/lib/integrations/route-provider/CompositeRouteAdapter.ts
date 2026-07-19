import type { RailRouteCandidate, RouteProviderPort } from "./RouteProviderPort";
import { FixtureRouteAdapter } from "./FixtureRouteAdapter";
import { generateRailRoute } from "./ai-route-generation";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";

/**
 * FixtureRouteAdapter を優先しつつ、fixture に無い駅間の経路は
 * Gemini の Google Search Grounding で検索の裏付けを取って生成する複合アダプター。
 *
 * AI生成結果は永続キャッシュしない(council議論2026-07-20: 検索を伴うAI生成は
 * 実行ごとに表現が揺れうる性質であり、初回生成結果を長期TTLで固定する設計自体が
 * この揺れと相性が悪いと判断。CompositeStationAdapterと同方針)。
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

    const [originStation, destinationStation] = await Promise.all([
      this.stationProvider.getStation(originStationId),
      this.stationProvider.getStation(destinationStationId),
    ]);
    if (!originStation || !destinationStation) return [];

    const generated = await generateRailRoute(this.geminiApiKey, originStation, destinationStation);
    if (!generated) return [];

    return [generated];
  }
}
