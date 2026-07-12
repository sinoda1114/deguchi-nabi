"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { Station } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";

export type OriginChoice =
  | { type: "home_station"; label: string }
  | { type: "station"; stationId: string; label: string };

interface OriginFieldProps {
  user: User | null;
  homeStation: Station | null;
  value: OriginChoice | null;
  onChange: (choice: OriginChoice | null) => void;
}

export function OriginField({ user, homeStation, value, onChange }: OriginFieldProps) {
  const [manualQuery, setManualQuery] = useState("");
  const [manualCandidates, setManualCandidates] = useState<Station[]>([]);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Station[]>([]);

  async function handleUseCurrentLocation() {
    setLocationError(null);
    setLocating(true);
    if (!("geolocation" in navigator)) {
      setLocationError("この端末では現在地を取得できません");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await apiFetch<{ stations: Station[] }>(
            `/api/stations/nearest?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`
          );
          setNearby(res.stations);
        } catch {
          setLocationError("最寄り駅の取得に失敗しました");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocationError("現在地の利用が許可されませんでした");
        setLocating(false);
      }
    );
  }

  async function handleManualSearch(q: string) {
    setManualQuery(q);
    if (!q.trim()) {
      setManualCandidates([]);
      return;
    }
    const res = await apiFetch<{ stations: Station[] }>(
      `/api/stations/search?q=${encodeURIComponent(q)}`
    );
    setManualCandidates(res.stations);
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
        出発地
      </label>
      <div className="flex flex-wrap gap-2">
        {user && homeStation ? (
          <button
            type="button"
            onClick={() =>
              onChange({ type: "home_station", label: `${homeStation.stationName}(登録駅)` })
            }
            className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-sm font-semibold ${
              value?.type === "home_station"
                ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
                : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            {homeStation.stationName}(登録駅)
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={locating}
          className="rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {locating ? "取得中…" : "現在地を使用"}
        </button>
      </div>

      {locationError ? (
        <p className="mt-1 text-xs text-[var(--confidence-low-fg)]">{locationError}</p>
      ) : null}

      {nearby.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {nearby.map((station) => (
            <button
              key={station.stationId}
              type="button"
              onClick={() =>
                onChange({ type: "station", stationId: station.stationId, label: station.stationName })
              }
              className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-sm ${
                value?.type === "station" && value.stationId === station.stationId
                  ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {station.stationName}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative mt-2">
        <input
          type="text"
          value={manualQuery}
          placeholder="駅名で指定"
          onChange={(e) => handleManualSearch(e.target.value)}
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        {manualCandidates.length > 0 ? (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-lg">
            {manualCandidates.map((station) => (
              <li key={station.stationId}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      type: "station",
                      stationId: station.stationId,
                      label: station.stationName,
                    });
                    setManualQuery(station.stationName);
                    setManualCandidates([]);
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-raised)]"
                >
                  {station.stationName}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
