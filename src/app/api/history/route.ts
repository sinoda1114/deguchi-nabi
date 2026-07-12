import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { listHistory } from "@/lib/store/history-repository";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  return NextResponse.json({ history: listHistory(user.userId) });
}
