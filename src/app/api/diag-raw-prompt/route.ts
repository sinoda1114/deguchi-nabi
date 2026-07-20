import { NextResponse } from "next/server";
import { createGoogle } from "@ai-sdk/google";
import { generateText } from "ai";

export const maxDuration = 120;

// 調査専用の使い捨てエンドポイント。ユーザーが用意したシステムプロンプトを
// そのままgemini-3.5-flash + google_search groundingで実行し、生テキストを
// 返す(構造化抽出は行わない、プロンプト自体の素の出力を見るための検証)。
// マージ・保守対象ではない。

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const prompt = body?.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const google = createGoogle({ apiKey });

  const start = Date.now();
  try {
    const result = await generateText({
      model: google("gemini-3.5-flash"),
      tools: { google_search: google.tools.googleSearch({}) },
      prompt,
      abortSignal: AbortSignal.timeout(90000),
    });
    return NextResponse.json({
      text: result.text,
      elapsedMs: Date.now() - start,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e), elapsedMs: Date.now() - start },
      { status: 500 }
    );
  }
}
