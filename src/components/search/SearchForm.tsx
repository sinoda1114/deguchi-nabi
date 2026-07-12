"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Station } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";
import type { RouteMode } from "@/lib/domain/route";
import { OriginField, type OriginChoice } from "./OriginField";
import { DestinationField } from "./DestinationField";
import { RouteModeSelector } from "./RouteModeSelector";
import type { SearchCandidate } from "@/lib/services/place-resolution";

interface SearchFormProps {
  user: User | null;
  homeStation: Station | null;
}

export function SearchForm({ user, homeStation }: SearchFormProps) {
  const router = useRouter();
  const [origin, setOrigin] = useState<OriginChoice | null>(
    user && homeStation ? { type: "home_station", label: homeStation.stationName } : null
  );
  const [destination, setDestination] = useState<SearchCandidate | null>(null);
  const [mode, setMode] = useState<RouteMode>("easy");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!origin) {
      setError("出発地を選択してください");
      return;
    }
    if (!destination) {
      setError("目的地を選択してください");
      return;
    }
    setError(null);

    const params = new URLSearchParams();
    params.set("originType", origin.type === "home_station" ? "home_station" : "station");
    if (origin.type === "station") params.set("originStationId", origin.stationId);
    params.set("destinationType", destination.kind === "station" ? "station" : "place");
    params.set(
      "destinationId",
      destination.kind === "station" ? destination.station.stationId : destination.destination.destinationId
    );
    params.set("mode", mode);

    router.push(`/routes/result?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <OriginField user={user} homeStation={homeStation} value={origin} onChange={setOrigin} />
      <DestinationField value={destination} onChange={setDestination} />
      <div>
        <span className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
          ルートモード
        </span>
        <RouteModeSelector value={mode} onChange={setMode} />
      </div>

      {error ? <p className="text-sm text-[var(--confidence-low-fg)]">{error}</p> : null}

      <button
        type="submit"
        className="rounded-[var(--radius-card)] bg-[var(--brand)] py-3 text-center font-bold text-[var(--brand-contrast)] transition-transform duration-[var(--duration-fast)] active:scale-[0.98]"
      >
        ルートを検索
      </button>
    </form>
  );
}
