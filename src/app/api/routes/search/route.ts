import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { addHistoryEntry } from "@/lib/store/history-repository";
import { resolveAndSearchRoute } from "@/lib/services/route-search-orchestrator";
import type { RouteMode } from "@/lib/domain/route";

const VALID_MODES: RouteMode[] = ["fastest", "easy", "accessible"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const mode: RouteMode = VALID_MODES.includes(body?.mode) ? body.mode : "easy";

  const origin = body?.origin;
  const destination = body?.destination;

  if (
    origin?.type !== "home_station" &&
    !(origin?.type === "station" && typeof origin.stationId === "string") &&
    !(origin?.type === "current_location" && typeof origin.stationId === "string")
  ) {
    return NextResponse.json({ error: "出発地を特定できません" }, { status: 400 });
  }
  if (
    !(destination?.type === "station" && typeof destination.stationId === "string") &&
    !(destination?.type === "place" && typeof destination.placeId === "string")
  ) {
    return NextResponse.json({ error: "目的地を特定できません" }, { status: 400 });
  }

  const sessionUser = await getSessionUser();

  const result = await resolveAndSearchRoute(
    {
      origin:
        origin.type === "home_station"
          ? { type: "home_station" }
          : { type: "station", stationId: origin.stationId },
      destination:
        destination.type === "station"
          ? { type: "station", stationId: destination.stationId }
          : { type: "place", placeId: destination.placeId },
      mode,
      accessibility: body?.accessibility,
    },
    sessionUser
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (sessionUser) {
    addHistoryEntry({
      userId: sessionUser.userId,
      routeGuideId: result.route.routeId,
      originLabel: result.originLabel,
      destinationLabel: result.destinationLabel,
      mode,
      query: {
        originStationId: result.originStationId,
        destinationStationId: result.destinationStationId,
        mode,
      },
    });
  }

  return NextResponse.json(result.route);
}
