import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { setHomeStation } from "@/lib/store/user-repository";
import { stationProvider } from "@/lib/integrations";

export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const stationId = typeof body?.stationId === "string" ? body.stationId : "";
  if (!stationId) {
    return NextResponse.json({ error: "stationId は必須です" }, { status: 400 });
  }

  const station = await stationProvider.getStation(stationId);
  if (!station) {
    return NextResponse.json({ error: "指定された駅が見つかりません" }, { status: 404 });
  }

  const user = setHomeStation(sessionUser.userId, stationId);
  return NextResponse.json({ user });
}
