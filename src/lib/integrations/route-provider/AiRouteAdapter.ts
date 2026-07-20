import type { RailRouteCandidate, RouteProviderPort } from "./RouteProviderPort";
import { generateRailRoute } from "./ai-route-generation";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";

/**
 * 全駅間の経路をGeminiのGoogle Search Groundingで検索の裏付けを取って生成する
 * アダプター。fixture(手動確認済みハードコードデータ)は2026-07-20に廃止した
 * (chore/remove-fixtures)。
 *
 * AI生成結果は永続キャッシュしない(council議論2026-07-20: 検索を伴うAI生成は
 * 実行ごとに表現が揺れうる性質であり、初回生成結果を長期TTLで固定する設計自体が
 * この揺れと相性が悪いと判断。AiStationAdapterと同方針)。
 */
export class AiRouteAdapter implements RouteProviderPort {
  constructor(
    private readonly geminiApiKey: string,
    private readonly stationProvider: StationProviderPort
  ) {}

  async findRailRoutes(
    originStationId: string,
    destinationStationId: string
  ): Promise<RailRouteCandidate[]> {
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
