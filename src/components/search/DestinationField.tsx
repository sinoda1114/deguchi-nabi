"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import type { SearchCandidate } from "@/lib/services/place-resolution";
import { candidateLabel } from "@/lib/services/place-resolution";

interface DestinationFieldProps {
  value: SearchCandidate | null;
  onChange: (candidate: SearchCandidate | null) => void;
}

export function DestinationField({ value, onChange }: DestinationFieldProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (value || debouncedQuery.trim().length === 0) {
      return;
    }
    let cancelled = false;
    apiFetch<{ candidates: SearchCandidate[] }>(
      `/api/places/search?q=${encodeURIComponent(debouncedQuery)}`
    )
      .then((res) => {
        if (!cancelled) setCandidates(res.candidates);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, value]);

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
        目的地
      </label>
      <input
        type="text"
        value={value ? candidateLabel(value) : query}
        placeholder="駅名・施設名・店舗名・住所"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
        className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
      />
      {open && !value && query.trim().length > 0 && candidates.length > 0 ? (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {candidates.map((candidate, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  onChange(candidate);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-[var(--surface-raised)]"
              >
                <span className="font-semibold">{candidateLabel(candidate)}</span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {candidate.kind === "station"
                    ? `駅・${candidate.station.prefecture}`
                    : `施設・${candidate.destination.address}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
