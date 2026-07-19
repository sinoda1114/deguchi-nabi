/**
 * 改札・出口AI生成のVision統合Grounding。
 *
 * council議論(2026-07-19)の結論: 実API評価でSerper検索パイプライン
 * (facilities-search-pipeline.ts)がGrounding比で大幅劣化(全滅9/20駅、
 * うち6駅は構内図が画像PNG/PDFのみでテキスト抽出が原理的に不可能)した。
 * 一方、構内図画像をGemini Visionに直接読ませるPoCでは改札名・出口名を
 * 正確に抽出できることを実証した。さらにGemini APIはgoogle_searchツールと
 * 画像入力(inline_data)を同一リクエストで併用できることも確認した。
 *
 * これを受け、Serperパイプラインを主系に育てる案(A)ではなく、既存の
 * Gemini Search Grounding呼び出しに画像入力を追加する案(B')を採用する
 * (セカンドオピニオン=Codexの推奨、実測データGrounding=860 vs Serper=150
 * を踏まえた判断)。Serperパイプラインは画像候補探索・限定的フォールバック
 * としての役割に留める。
 *
 * 画像が見つからない/取得できない場合は、画像なしの既存Grounding
 * (generateStationFacilities)へフォールバックする — Vision統合前と同じ
 * 挙動を維持し、悪化させないため。
 */

import type { Coordinates, StationFacility } from "@/lib/domain/station";
import {
  generateStationFacilities,
  groundedAiConfidence,
  isValidFacility,
  locationHint,
  toStationFacility,
  FACILITIES_SCHEMA,
  type GeneratedFacility,
} from "./ai-generation";
import { searchAndGenerateStructuredContentWithImage } from "@/lib/integrations/ai/GeminiClient";
import { findStationFloorMapImage } from "@/lib/integrations/search/facilities-image-search";

export async function generateStationFacilitiesWithVision(
  geminiApiKey: string,
  serperApiKey: string,
  stationName: string,
  operator: string,
  lines: string[],
  coordinates: Coordinates | null,
  destinationHint: string | null
): Promise<StationFacility[]> {
  const image = await findStationFloorMapImage(serperApiKey, stationName, operator);

  if (!image) {
    return generateStationFacilities(
      geminiApiKey,
      stationName,
      operator,
      lines,
      coordinates,
      destinationHint
    );
  }

  const stationLabel = operator
    ? `${stationName}(${operator}、${lines.join("・")})${locationHint(coordinates)}`
    : `${stationName}(${lines.join("・")})${locationHint(coordinates)}`;

  const destinationInstruction = destinationHint
    ? `\nまた、上記の駅全体の回答とは別に、「${destinationHint}」へのアクセス情報(最寄り改札・出口)も検索してください。目的地の公式サイト・グルメサイト等のアクセス情報ページで最寄り改札・出口が確認できた場合は、それも回答に追加してください。確認できなかった場合でも、駅の主要な改札・出口の回答は通常どおり行ってください。`
    : "";

  const searchPrompt = `添付した画像は${stationLabel}の構内図です。画像内のラベルを最優先の情報源として、改札名・出口名・エスカレーター/エレベーターの位置を、画像に写っているものは省略せずできるだけ全て列挙してください(代表例だけに絞らないでください)。Web検索の結果も照合し、画像に無い情報で確認できたものがあれば追加してください。${destinationInstruction}
画像からもWeb検索でも確認できない改札・出口・設備は創作しないでください。
同じ駅名が他にも存在する場合は、必ず上記の位置に最も近い駅を対象にしてください。`;

  const extractionInstruction = `以下の文章から、確認できた改札・出口・エスカレーター/エレベーターの情報をJSON形式で抽出してください。
確信が持てないものは含めないでください。各項目について、あなた自身がその情報にどれだけ自信があるかをhigh/medium/lowで自己申告してください(自信が持てない場合はその項目自体を含めないでください)。`;

  const result = await searchAndGenerateStructuredContentWithImage<{
    facilities: GeneratedFacility[];
  }>(geminiApiKey, searchPrompt, extractionInstruction, FACILITIES_SCHEMA, image);

  // 画像付きGrounding呼び出しは同一条件でも失敗(検索が実行されない/JSON応答が
  // 不正)することがある実測フレーク挙動を確認したため(東京駅、2回連続実行で
  // score=100→0)、結果が使えない(null / facilitiesが空・不正な形式 /
  // 全要素がisValidFacilityで弾かれる)場合は画像なしGrounding
  // (generateStationFacilities)へフォールバックする。フィルタ「前」の配列長
  // だけで判定すると、要素が形式不正で全滅した場合にフォールバックし損ねる
  // バグがあったため、フィルタ「後」の件数で判定する(/ai-review指摘、Medium)。
  // これにより、Vision呼び出しが不安定に失敗しても、既存のGrounding精度を
  // 下回らない安全網になる。
  const validFacilities = Array.isArray(result?.facilities)
    ? result.facilities.filter(isValidFacility)
    : [];

  if (validFacilities.length > 0) {
    return validFacilities.map((f) => toStationFacility(f, groundedAiConfidence(f.confidence), null));
  }

  return generateStationFacilities(
    geminiApiKey,
    stationName,
    operator,
    lines,
    coordinates,
    destinationHint
  );
}
