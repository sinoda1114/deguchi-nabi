import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  addFavoriteDestination,
  listFavoriteDestinations,
} from "@/lib/store/favorite-destination-repository";
import { toFavoriteDestinationInput, type SearchCandidate } from "@/lib/services/place-resolution";
import type { Destination, Station } from "@/lib/domain/station";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  return NextResponse.json({ favoriteDestinations: listFavoriteDestinations(user.userId) });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const candidate = parseCandidate(body?.candidate);
  if (!candidate) {
    return NextResponse.json({ error: "保存に必要な情報が不足しています" }, { status: 400 });
  }

  const result = addFavoriteDestination(user.userId, toFavoriteDestinationInput(candidate));
  if (!result.ok) {
    return NextResponse.json(
      { error: "登録できる目的地の上限に達しています" },
      { status: 409 }
    );
  }
  return NextResponse.json({ favoriteDestination: result.favoriteDestination });
}

function isValidStation(value: unknown): value is Station {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.stationId === "string" &&
    typeof s.stationName === "string" &&
    typeof s.operator === "string" &&
    Array.isArray(s.lines) &&
    typeof s.prefecture === "string" &&
    typeof s.latitude === "number" &&
    typeof s.longitude === "number"
  );
}

function isValidDestination(value: unknown): value is Destination {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.destinationId === "string" &&
    typeof d.name === "string" &&
    typeof d.category === "string" &&
    typeof d.address === "string" &&
    typeof d.latitude === "number" &&
    typeof d.longitude === "number" &&
    Array.isArray(d.nearestStationCandidates)
  );
}

function parseCandidate(raw: unknown): SearchCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === "station" && isValidStation(value.station)) {
    return { kind: "station", station: value.station };
  }
  if (value.kind === "place" && isValidDestination(value.destination)) {
    return { kind: "place", destination: value.destination };
  }
  return null;
}
