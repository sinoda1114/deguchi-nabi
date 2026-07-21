import type { RailRouteCandidate, RouteProviderPort } from "./RouteProviderPort";
import type { Coordinates } from "@/lib/domain/station";
import type { StationProviderPort } from "@/lib/integrations/station-provider/StationProviderPort";
import {
  buildSharedGuideCacheKey,
  generateSingleCallNavigatorGuide,
  getSharedSingleCallNavigatorGuide,
} from "@/lib/integrations/ai/single-call-navigator";

/**
 * 全駅間の経路をGeminiのGoogle Search Groundingで検索の裏付けを取って生成する
 * アダプター。fixture(手動確認済みハードコードデータ)は2026-07-20に廃止した
 * (chore/remove-fixtures)。
 *
 * 2026-07-21: 経路生成(ai-route-generation.ts)を単体で呼ぶのをやめ、単一呼び出し
 * (single-call-navigator.ts)の生成結果を使うよう変更した(路線・乗換回数・
 * 所要時間に加え、改札・出口・乗車位置・徒歩ルートまで1回の検索セッションで
 * まとめて生成する方式への統合)。destinationHintが渡された場合、
 * getSharedSingleCallNavigatorGuideによりAiStationAdapter.getUnifiedArrivalGuide
 * 側の呼び出しと結果を共有するため、1リクエストでGeminiを2回呼ばずに済む
 * (single-call-navigator.tsのJSDoc参照)。
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
    destinationStationId: string,
    destinationHint: string | null = null,
    destinationPlaceCoordinates: Coordinates | null = null
  ): Promise<RailRouteCandidate[]> {
    const [originStation, destinationStation] = await Promise.all([
      this.stationProvider.getStation(originStationId),
      this.stationProvider.getStation(destinationStationId),
    ]);
    if (!originStation || !destinationStation) return [];

    const cacheKey = buildSharedGuideCacheKey(
      originStationId,
      destinationStationId,
      destinationHint,
      destinationPlaceCoordinates
    );
    const guide = await getSharedSingleCallNavigatorGuide(cacheKey, () =>
      generateSingleCallNavigatorGuide(
        this.geminiApiKey,
        originStation,
        destinationStation,
        destinationHint,
        destinationPlaceCoordinates
      )
    );
    if (!guide) return [];

    return [
      {
        originStationId: originStation.stationId,
        arrivalStationId: destinationStation.stationId,
        transferCount: guide.transferCount,
        estimatedDurationMinutes: guide.estimatedMinutes,
        isAiGenerated: true,
        segments: [
          {
            fromStationId: originStation.stationId,
            toStationId: destinationStation.stationId,
            line: guide.lines.join("・"),
            direction: destinationStation.stationName,
            platformId: guide.arrivalPlatformNumber ?? "",
            estimatedMinutes: guide.estimatedMinutes,
          },
        ],
      },
    ];
  }
}
