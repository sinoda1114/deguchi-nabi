import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { addFavorite, listFavorites } from "@/lib/store/favorite-repository";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  return NextResponse.json({ favorites: listFavorites(user.userId) });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const routeGuideId = typeof body?.routeGuideId === "string" ? body.routeGuideId : "";
  const label = typeof body?.label === "string" ? body.label : "";
  const query = body?.query;

  if (!routeGuideId || !label || !query?.originStationId || !query?.destinationStationId || !query?.mode) {
    return NextResponse.json({ error: "保存に必要な情報が不足しています" }, { status: 400 });
  }

  const favorite = addFavorite(user.userId, routeGuideId, label, {
    originStationId: query.originStationId,
    destinationStationId: query.destinationStationId,
    mode: query.mode,
  });
  return NextResponse.json({ favorite });
}
