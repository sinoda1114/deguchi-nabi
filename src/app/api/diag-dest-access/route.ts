import { NextResponse } from "next/server";
import { searchAndGenerateStructuredContent } from "@/lib/integrations/ai/GeminiAiSdkClient";

export const maxDuration = 120;

// 調査専用の使い捨てエンドポイント。「目的地公式情報を優先検索する」という
// 合わせ技の第1段階(専用の焦点を絞った検索フェーズ)が実際に機能するかを
// 単体で検証する(experiment/destination-fix-then-vote、マージ・保守対象外)。
// 既存のunified-arrival-guide-generation.tsは改札・出口・徒歩・号車の4項目
// を1つのプロンプトに詰め込んでおり、目的地優先の指示が埋もれていた可能性
// があるため、ここでは「目的地の公式サイト等に明記された出口・改札」だけを
// 単独で聞く、より焦点を絞った検索にする。

const SCHEMA = {
  type: "object",
  properties: {
    exitName: { type: "string" },
    gateName: { type: "string" },
    sourceDescription: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

async function searchDestinationStatedAccess(
  apiKey: string,
  destinationHint: string,
  lat: number,
  lng: number
) {
  const searchPrompt = `「${destinationHint}」(緯度${lat}・経度${lng}付近)の公式サイト・食べログ・ぐるなび・一休.com等の予約/口コミサイトを検索してください。
それらのページに「〇〇駅△△出口から徒歩□分」のように、目的地自身が明記している具体的な出口名・改札名があれば教えてください。
一般的な「最寄り駅は〇〇駅です」程度の記載しかない場合、または出口名・改札名が明記されていない場合は、無理に推測せず「記載なし」と回答してください。`;

  const extractionInstruction = `以下の文章から、目的地の公式サイト等に明記されていた具体的な出口名・改札名をJSON形式で抽出してください。
明記されていなかった場合はexitName/gateNameのプロパティ自体を省略してください。
sourceDescriptionには、どのサイト(公式サイト/食べログ等)から得た情報かを簡潔に記載してください。
自信の度合いをhigh/medium/lowで自己申告してください。`;

  return searchAndGenerateStructuredContent<{
    exitName?: string;
    gateName?: string;
    sourceDescription?: string;
    confidence?: string;
  }>(
    apiKey,
    searchPrompt,
    extractionInstruction,
    SCHEMA,
    "diag-dest-access",
    "gemini-3.5-flash",
    "gemini-3.5-flash"
  );
}

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  const targets = [
    { name: "kawara CAFE&DINING 横浜店", lat: 35.4640221, lng: 139.6200651 },
    { name: "しゃぶしゃぶ×居酒屋 ウエチャベ", lat: 35.6587716, lng: 139.6982764 },
  ];

  // 目的地間・各目的地内の3回とも直列にせず全て並列で発火する(逐次実行だと
  // 待ち時間が線形に増えるため)。
  const allRuns = await Promise.all(
    targets.flatMap((t) =>
      Array.from({ length: 3 }, () => searchDestinationStatedAccess(apiKey, t.name, t.lat, t.lng))
    )
  );

  const results: Record<string, unknown> = {};
  targets.forEach((t, i) => {
    results[t.name] = allRuns.slice(i * 3, i * 3 + 3);
  });

  return NextResponse.json(results);
}
