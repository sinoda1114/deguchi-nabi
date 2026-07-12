import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { removeFavorite } from "@/lib/store/favorite-repository";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ favoriteId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  const { favoriteId } = await params;
  removeFavorite(user.userId, favoriteId);
  return NextResponse.json({ ok: true });
}
