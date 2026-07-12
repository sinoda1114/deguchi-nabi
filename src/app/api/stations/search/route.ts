import { NextRequest, NextResponse } from "next/server";
import { stationProvider } from "@/lib/integrations";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const stations = await stationProvider.searchStations(query);
  return NextResponse.json({ stations });
}
