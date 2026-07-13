"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@heroui/react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import type { SearchCandidate } from "@/lib/services/place-resolution";
import { candidateLabel, isSameFavoriteTarget, toSearchCandidate } from "@/lib/services/place-resolution";
import { sortFavoriteDestinationsByRecency } from "@/lib/services/favorite-destination-order";
import { splitForDisclosure } from "@/lib/services/progressive-disclosure";
import { SearchPictogram } from "./SearchPictogram";
import type { Coordinates } from "@/lib/domain/station";
import type { FavoriteDestination, User } from "@/lib/domain/user";

interface DestinationFieldProps {
  user: User | null;
  favoriteDestinations: FavoriteDestination[];
  value: SearchCandidate | null;
  onChange: (candidate: SearchCandidate | null) => void;
  /** 出発地の座標。渡すと検索結果がその付近を優先するようになる(位置バイアス)。 */
  originCoordinates?: Coordinates | null;
}

// ヒックの法則(選択肢が多いほど意思決定が遅くなる)を踏まえ、登録が新しい順の先頭3件だけを
// 自動露出し、残りは「もっと見る」で展開する progressive disclosure にする。
const FAVORITE_PRIMARY_COUNT = 3;

export function DestinationField({
  user,
  favoriteDestinations,
  value,
  onChange,
  originCoordinates = null,
}: DestinationFieldProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState(favoriteDestinations);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAllFavorites, setShowAllFavorites] = useState(false);

  useEffect(() => {
    if (value || debouncedQuery.trim().length === 0) {
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ q: debouncedQuery });
    if (originCoordinates) {
      params.set("lat", String(originCoordinates.lat));
      params.set("lng", String(originCoordinates.lng));
    }
    apiFetch<{ candidates: SearchCandidate[] }>(`/api/places/search?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setCandidates(res.candidates);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
    // originCoordinates はSearchForm側で毎レンダー新規オブジェクトとして渡されるため、
    // オブジェクト参照ではなく値(lat/lng)で依存を見て不要な再検索を防ぐ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, value, originCoordinates?.lat, originCoordinates?.lng]);

  const isSaved = value ? favorites.some((f) => isSameFavoriteTarget(f, value)) : false;
  const sortedFavorites = sortFavoriteDestinationsByRecency(favorites);
  const { primary: primaryFavorites, more: moreFavorites } = splitForDisclosure(
    sortedFavorites,
    FAVORITE_PRIMARY_COUNT
  );
  const visibleFavorites = showAllFavorites ? sortedFavorites : primaryFavorites;

  async function handleSaveFavorite() {
    if (!value || saving || isSaved) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch<{ favoriteDestination: FavoriteDestination }>(
        "/api/favorite-destinations",
        { method: "POST", body: JSON.stringify({ candidate: value }) }
      );
      setFavorites((prev) => [...prev, res.favoriteDestination]);
    } catch (error) {
      // 検索自体は継続できるよう、ボタンを再度押し直せる状態に戻しつつエラーだけ表示する
      setSaveError(
        error instanceof ApiError
          ? error.message
          : "目的地の登録に失敗しました。もう一度お試しください。"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <label className="mb-1 flex items-center gap-1 text-xs font-bold text-[var(--foreground-muted)]">
        <SearchPictogram type="destination" className="h-3.5 w-3.5" />
        目的地
      </label>

      {favorites.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {visibleFavorites.map((favorite) => (
            <Button
              key={favorite.favoriteDestinationId}
              size="sm"
              variant={value && isSameFavoriteTarget(favorite, value) ? "primary" : "secondary"}
              onPress={() => {
                onChange(toSearchCandidate(favorite));
                setOpen(false);
              }}
            >
              {favorite.label}
            </Button>
          ))}
          {!showAllFavorites && moreFavorites.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={showAllFavorites}
              onPress={() => setShowAllFavorites(true)}
            >
              もっと見る({moreFavorites.length}件)
            </Button>
          ) : null}
        </div>
      ) : null}

      <Input
        type="text"
        value={value ? candidateLabel(value) : query}
        placeholder="駅名・施設名・店舗名・住所"
        aria-label="目的地"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
      />

      {value && user ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={isSaved}
            isPending={saving}
            onPress={handleSaveFavorite}
            className="mt-2"
          >
            {isSaved ? (
              "追加済み"
            ) : (
              <>
                <SearchPictogram type="favorite" className="h-3.5 w-3.5" />
                よく使う行き先に追加
              </>
            )}
          </Button>
          {saveError ? (
            <p className="mt-1 text-xs text-[var(--danger)]">{saveError}</p>
          ) : null}
        </>
      ) : null}

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
