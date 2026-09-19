import { NextResponse } from "next/server";
import { checkJevHealth } from "@/lib/integrations/jev/JevClient";

/**
 * TypeSafe System One (JEV) 疎通確認エンドポイント
 *
 * JEV_API_KEYがVercel環境変数に設定されているかを確認し、
 * TypeSafe System Oneとの疎通をテストする。
 *
 * レスポンス:
 * - 200 { ok: true } - 正常に疎通確認完了
 * - 503 { ok: false, reason: "missing_key" } - JEV_API_KEYが未設定
 * - 502 { ok: false, reason: "upstream_error" | "timeout" } - 上流エラーまたはタイムアウト
 */
export async function GET() {
  const result = await checkJevHealth();

  if (!result.ok) {
    const statusCode = result.reason === "missing_key" ? 503 : 502;
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: statusCode }
    );
  }

  return NextResponse.json({ ok: true });
}
