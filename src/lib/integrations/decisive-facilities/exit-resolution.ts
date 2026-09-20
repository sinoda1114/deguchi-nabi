import type { Coordinates, StationFacility } from "@/lib/domain/station";
import { haversineMeters } from "@/lib/geo/haversine";
import { bearingDegrees, bearingDifferenceDegrees, compassLabel } from "@/lib/geo/bearing";

export type ExitResolutionTier = "exact" | "approximate" | "unavailable";

export interface ExitResolution {
  tier: ExitResolutionTier;
  exit: StationFacility | null;
  gate: StationFacility | null;
  destinationDirectionLabel: string | null;
}

const MIN_BEARING_CHECK_DISTANCE_METERS = 80;
const EXIT_BEARING_MISMATCH_THRESHOLD_DEGREES = 90;

function pickNearestFacility(
  facilities: StationFacility[],
  facilityType: StationFacility["facilityType"],
  destinationCoordinates: Coordinates | null
): StationFacility | null {
  const candidates = facilities.filter((f) => f.facilityType === facilityType);
  if (candidates.length === 0) return null;
  if (!destinationCoordinates) return candidates[0];

  let best: StationFacility | null = null;
  let bestDistance = Infinity;
  for (const facility of candidates) {
    if (!facility.coordinates) continue;
    const distance = haversineMeters(
      destinationCoordinates.lat,
      destinationCoordinates.lng,
      facility.coordinates.lat,
      facility.coordinates.lng
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = facility;
    }
  }
  return best ?? candidates.find((f) => f.coordinates) ?? candidates[0];
}

function pickGateForExit(facilities: StationFacility[], exit: StationFacility | null): StationFacility | null {
  if (exit?.connectedGateId) {
    const linkedGate = facilities.find(
      (f) => f.facilityId === exit.connectedGateId && f.facilityType === "gate"
    );
    if (linkedGate) return linkedGate;
  }
  const gates = facilities.filter((f) => f.facilityType === "gate");
  return gates.length > 0 ? gates[0] : null;
}

/**
 * route-search.ts と同じ方角チェック付き出口選定。決定的データ(fixture/OSM)向けに共通化。
 */
export function resolveExitAndGateFromFacilities(
  facilities: StationFacility[],
  destinationCoordinates: Coordinates | null,
  stationCenter: Coordinates | null
): ExitResolution {
  const exitCandidates = facilities.filter((f) => f.facilityType === "exit");
  if (exitCandidates.length === 0) {
    return { tier: "unavailable", exit: null, gate: null, destinationDirectionLabel: null };
  }

  if (!destinationCoordinates) {
    const exit = pickNearestFacility(facilities, "exit", null);
    return {
      tier: exit ? "exact" : "unavailable",
      exit,
      gate: pickGateForExit(facilities, exit),
      destinationDirectionLabel: null,
    };
  }

  if (!stationCenter) {
    return { tier: "unavailable", exit: null, gate: null, destinationDirectionLabel: null };
  }

  const distanceToDestinationMeters = haversineMeters(
    stationCenter.lat,
    stationCenter.lng,
    destinationCoordinates.lat,
    destinationCoordinates.lng
  );

  if (distanceToDestinationMeters < MIN_BEARING_CHECK_DISTANCE_METERS) {
    const exit = pickNearestFacility(facilities, "exit", destinationCoordinates);
    return {
      tier: exit ? "exact" : "unavailable",
      exit,
      gate: pickGateForExit(facilities, exit),
      destinationDirectionLabel: null,
    };
  }

  const targetBearing = bearingDegrees(
    stationCenter.lat,
    stationCenter.lng,
    destinationCoordinates.lat,
    destinationCoordinates.lng
  );
  const destinationDirectionLabel = compassLabel(targetBearing);

  const withCoordinates = exitCandidates.filter((f) => f.coordinates !== null);
  if (withCoordinates.length === 0) {
    return { tier: "approximate", exit: null, gate: null, destinationDirectionLabel };
  }

  const nearest = pickNearestFacility(facilities, "exit", destinationCoordinates);
  if (!nearest?.coordinates) {
    return { tier: "approximate", exit: null, gate: null, destinationDirectionLabel };
  }

  const nearestBearing = bearingDegrees(
    stationCenter.lat,
    stationCenter.lng,
    nearest.coordinates.lat,
    nearest.coordinates.lng
  );
  const bearingDiff = bearingDifferenceDegrees(targetBearing, nearestBearing);

  if (bearingDiff > EXIT_BEARING_MISMATCH_THRESHOLD_DEGREES) {
    return { tier: "approximate", exit: null, gate: null, destinationDirectionLabel };
  }

  return {
    tier: "exact",
    exit: nearest,
    gate: pickGateForExit(facilities, nearest),
    destinationDirectionLabel: null,
  };
}
