import { NextResponse } from "next/server";
import { stationProvider } from "@/lib/integrations";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ stationId: string }> }
) {
  const { stationId } = await params;
  const normalizedStationId = stationId.trim();
  if (!normalizedStationId) {
    return NextResponse.json({ error: "stationId が不正です" }, { status: 400 });
  }

  const station = await stationProvider.getStation(normalizedStationId);
  if (!station) {
    return NextResponse.json({ error: "駅が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ station });
}
