"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { Station } from "@/lib/domain/station";

interface HomeStationFormProps {
  currentStation: Station | null;
  redirectTo?: string;
}

export function HomeStationForm({ currentStation, redirectTo }: HomeStationFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(currentStation?.stationName ?? "");
  const [candidates, setCandidates] = useState<Station[]>([]);
  const [selected, setSelected] = useState<Station | null>(currentStation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(q: string) {
    setQuery(q);
    setSelected(null);
    if (!q.trim()) {
      setCandidates([]);
      return;
    }
    const res = await apiFetch<{ stations: Station[] }>(
      `/api/stations/search?q=${encodeURIComponent(q)}`
    );
    setCandidates(res.stations);
  }

  async function handleSave() {
    if (!selected) {
      setError("駅を選択してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/me/home-station", {
        method: "PATCH",
        body: JSON.stringify({ stationId: selected.stationId }),
      });
      router.push(redirectTo ?? "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="駅名を入力"
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
        />
        {candidates.length > 0 && !selected ? (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-lg">
            {candidates.map((station) => (
              <li key={station.stationId}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(station);
                    setQuery(station.stationName);
                    setCandidates([]);
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

      {error ? <p className="text-sm text-[var(--confidence-low-fg)]">{error}</p> : null}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-[var(--radius-card)] bg-[var(--brand)] py-3 text-center font-bold text-[var(--brand-contrast)] disabled:opacity-60"
      >
        {saving ? "保存中…" : "最寄り駅を保存"}
      </button>
    </div>
  );
}
