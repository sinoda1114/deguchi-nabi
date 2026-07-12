import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { removeFavoriteDestination } from "@/lib/store/favorite-destination-repository";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ favoriteDestinationId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  const { favoriteDestinationId } = await params;
  removeFavoriteDestination(user.userId, favoriteDestinationId);
  return NextResponse.json({ ok: true });
}
