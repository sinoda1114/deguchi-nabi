/**
 * 改札・出口AI生成のバックエンドを環境変数で切り替えるディスパッチャ。
 *
 * - FACILITIES_SEARCH_BACKEND === "vision-grounding" かつ SERPER_API_KEY が
 *   あるときは、構内図画像+Google Search Groundingを統合したVision対応
 *   バックエンド(facilities-vision-generation.ts)を使う(council議論
 *   2026-07-19の結論。実API評価でSerperパイプラインがGrounding比で大幅
 *   劣化した一方、画像Vision統合はPoCで有効性を実証済み)。
 * - FACILITIES_SEARCH_BACKEND === "serper" かつ SERPER_API_KEY があるときは
 *   Serper 検索パイプライン(facilities-search-pipeline.ts、テキストのみ)を
 *   使う。ただし実API評価で全滅9/20駅と判明しているため、評価目的以外での
 *   本番使用は推奨しない。
 * - それ以外(未設定 / "grounding" / 各バックエンド指定でもSERPER_API_KEY
 *   未設定)は従来の Gemini Search Grounding(generateStationFacilities)に
 *   フォールバックする。
 *
 * デフォルト(未設定)は grounding のため、本番挙動は変わらない。
 */

import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { generateStationFacilities } from "./ai-generation";
import { searchStationFacilitiesViaPipeline } from "@/lib/integrations/search/facilities-search-pipeline";
import { generateStationFacilitiesWithVision } from "./facilities-vision-generation";

export async function generateStationFacilitiesDispatch(
  apiKey: string,
  stationName: string,
  operator: string,
  lines: string[],
  coordinates: Coordinates | null,
  destinationHint: string | null
): Promise<StationFacility[]> {
  const backend = process.env.FACILITIES_SEARCH_BACKEND;
  const serperApiKey = process.env.SERPER_API_KEY;

  if (backend === "vision-grounding") {
    if (serperApiKey) {
      return generateStationFacilitiesWithVision(
        apiKey,
        serperApiKey,
        stationName,
        operator,
        lines,
        coordinates,
        destinationHint
      );
    }
    console.warn(
      "[facilities-generation] FACILITIES_SEARCH_BACKEND=vision-grounding だが SERPER_API_KEY が未設定のため、Gemini Search Grounding にフォールバックします。"
    );
  }

  if (backend === "serper") {
    if (serperApiKey) {
      // JINA_API_KEY は任意。未設定でも Jina Reader は動くため null 許容で渡す。
      const jinaApiKey = process.env.JINA_API_KEY ?? null;
      return searchStationFacilitiesViaPipeline(
        { serperApiKey, jinaApiKey, geminiApiKey: apiKey },
        stationName,
        operator,
        lines,
        coordinates,
        destinationHint
      );
    }
    console.warn(
      "[facilities-generation] FACILITIES_SEARCH_BACKEND=serper だが SERPER_API_KEY が未設定のため、Gemini Search Grounding にフォールバックします。"
    );
  }

  return generateStationFacilities(apiKey, stationName, operator, lines, coordinates, destinationHint);
}
