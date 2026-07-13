"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@heroui/react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import type { SearchCandidate } from "@/lib/services/place-resolution";
import {
  candidateLabel,
  isSameFavoriteTarget,
  toFavoriteDestinationInput,
  toSearchCandidate,
} from "@/lib/services/place-resolution";
import { sortFavoriteDestinationsByRecency } from "@/lib/services/favorite-destination-order";
import { addLocalFavoriteDestination, listLocalFavoriteDestinations } from "@/lib/services/local-favorite-destinations";
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

/** 検索候補を一意に識別するキー(登録済み判定・保存中状態の管理に使う)。 */
export function candidateKey(candidate: SearchCandidate): string {
  return candidate.kind === "station"
    ? `station:${candidate.station.stationId}`
    : `place:${candidate.destination.destinationId}`;
}

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
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // ログイン中は親から渡るfavoriteDestinations(サーバー確定値)にそのまま追従する
  // (ログイン後にローカル保存分をサーバーへ移行した場合の再取得にも対応するため)。
  // 未ログイン中は、SSRでは取得できないlocalStorage(外部システム)の内容をここで取り込む
  // 必要があり、レンダー中に直接読むとSSR/CSRでhydration mismatchになるためuseEffectで行う。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (user) {
      setFavorites(favoriteDestinations);
      return;
    }
    const local = listLocalFavoriteDestinations();
    const existingIds = new Set(favoriteDestinations.map((f) => f.favoriteDestinationId));
    setFavorites([
      ...favoriteDestinations,
      ...local.filter((f) => !existingIds.has(f.favoriteDestinationId)),
    ]);
  }, [user, favoriteDestinations]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isFavorited = (candidate: SearchCandidate) =>
    favorites.some((f) => isSameFavoriteTarget(f, candidate));
  const isSaved = value ? isFavorited(value) : false;
  const sortedFavorites = sortFavoriteDestinationsByRecency(favorites);

  async function saveFavorite(candidate: SearchCandidate) {
    const key = candidateKey(candidate);
    if (savingKey || isFavorited(candidate)) return;
    setSavingKey(key);
    setSaveError(null);

    // 未ログイン時はサーバーに送らずlocalStorageへ保存する(ログイン後にサーバー側へ移行できる)。
    if (!user) {
      const result = addLocalFavoriteDestination(toFavoriteDestinationInput(candidate));
      if (result.ok) {
        setFavorites((prev) => [...prev, result.favoriteDestination]);
      } else if (result.reason === "limit_exceeded") {
        setSaveError("登録できる目的地の上限に達しています");
      } else {
        setSaveError("この端末に保存できませんでした。ブラウザの設定をご確認ください。");
      }
      setSavingKey(null);
      return;
    }

    try {
      const res = await apiFetch<{ favoriteDestination: FavoriteDestination }>(
        "/api/favorite-destinations",
        { method: "POST", body: JSON.stringify({ candidate }) }
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
      setSavingKey(null);
    }
  }

  return (
    <div className="relative">
      <label className="mb-1 flex items-center gap-1 text-xs font-bold text-[var(--foreground-muted)]">
        <SearchPictogram type="destination" className="h-3.5 w-3.5" />
        目的地
      </label>

      {favorites.length > 0 ? (
        <div className="mb-2 flex flex-nowrap gap-2 overflow-hidden">
          {sortedFavorites.map((favorite) => (
            <Button
              key={favorite.favoriteDestinationId}
              size="sm"
              variant={value && isSameFavoriteTarget(favorite, value) ? "primary" : "secondary"}
              onPress={() => {
                onChange(toSearchCandidate(favorite));
                setOpen(false);
              }}
              className="shrink-0"
            >
              {favorite.label}
            </Button>
          ))}
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

      {value ? (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={isSaved}
          isPending={savingKey === candidateKey(value)}
          onPress={() => saveFavorite(value)}
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
      ) : null}

      {/* 選択確定前の候補一覧からの星クリックでも失敗しうるため、value有無に関わらず表示する */}
      {saveError ? <p className="mt-1 text-xs text-[var(--danger)]">{saveError}</p> : null}

      {open && !value && query.trim().length > 0 && candidates.length > 0 ? (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {candidates.map((candidate) => {
            const key = candidateKey(candidate);
            const favorited = isFavorited(candidate);
            return (
              <li key={key} className="flex items-center gap-1 hover:bg-[var(--surface-raised)]">
                <button
                  type="button"
                  onClick={() => {
                    onChange(candidate);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-left text-sm"
                >
                  <span className="font-semibold">{candidateLabel(candidate)}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {candidate.kind === "station"
                      ? `駅・${candidate.station.prefecture}`
                      : `施設・${candidate.destination.address}`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    saveFavorite(candidate);
                  }}
                  disabled={favorited || savingKey !== null}
                  aria-label={favorited ? "登録済み" : "よく使う行き先に追加"}
                  aria-pressed={favorited}
                  className="mr-2 shrink-0 p-1 disabled:cursor-default"
                >
                  <SearchPictogram
                    type="favorite"
                    filled={favorited}
                    className={`h-4 w-4 ${favorited ? "text-[var(--accent)]" : "text-[var(--foreground-muted)]"}`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
