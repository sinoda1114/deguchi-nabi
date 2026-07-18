/**
 * 改札・出口AI生成のバックエンドを環境変数で切り替えるディスパッチャ。
 *
 * FACILITIES_SEARCH_BACKEND === "serper" かつ SERPER_API_KEY があるときのみ
 * Serper 検索パイプライン(facilities-search-pipeline.ts)を使う。
 * それ以外(未設定 / "grounding" / serper指定でもSERPER_API_KEY未設定)は
 * 従来の Gemini Search Grounding(generateStationFacilities)にフォールバックする。
 *
 * このPRではデフォルト(未設定)が grounding のため、本番挙動は変わらない。
 * 評価ゲート通過後に本番で serper へ切り替える想定。
 */

import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { generateStationFacilities } from "./ai-generation";
import { searchStationFacilitiesViaPipeline } from "@/lib/integrations/search/facilities-search-pipeline";

export async function generateStationFacilitiesDispatch(
  apiKey: string,
  stationName: string,
  operator: string,
  lines: string[],
  coordinates: Coordinates | null,
  destinationHint: string | null
): Promise<StationFacility[]> {
  const backend = process.env.FACILITIES_SEARCH_BACKEND;

  if (backend === "serper") {
    const serperApiKey = process.env.SERPER_API_KEY;
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
