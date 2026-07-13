import { NextRequest, NextResponse } from "next/server";
import { placeProvider, stationProvider } from "@/lib/integrations";
import { parseCoordinatesParam, searchDestinationCandidates } from "@/lib/services/place-resolution";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const near = parseCoordinatesParam(
    req.nextUrl.searchParams.get("lat"),
    req.nextUrl.searchParams.get("lng")
  );
  const candidates = await searchDestinationCandidates(
    query,
    { stationProvider, placeProvider },
    near
  );
  return NextResponse.json({ candidates });
}
