import { NextRequest, NextResponse } from "next/server";
import { placeProvider, stationProvider } from "@/lib/integrations";
import { searchDestinationCandidates } from "@/lib/services/place-resolution";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const candidates = await searchDestinationCandidates(query, {
    stationProvider,
    placeProvider,
  });
  return NextResponse.json({ candidates });
}
