import { NextRequest, NextResponse } from "next/server";
import { stationProvider } from "@/lib/integrations";

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat/lng が不正です" }, { status: 400 });
  }

  const stations = await stationProvider.nearestStations(lat, lng, 5);
  return NextResponse.json({ stations });
}
