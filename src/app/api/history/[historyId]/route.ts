import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { removeHistoryEntry } from "@/lib/store/history-repository";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ historyId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  const { historyId } = await params;
  removeHistoryEntry(user.userId, historyId);
  return NextResponse.json({ ok: true });
}
