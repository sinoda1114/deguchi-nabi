"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { Station } from "@/lib/domain/station";
import type { FavoriteDestination, User } from "@/lib/domain/user";
import type { RouteMode } from "@/lib/domain/route";
import { OriginField, type OriginChoice } from "./OriginField";
import { DestinationField } from "./DestinationField";
import { RouteModeSelector } from "./RouteModeSelector";
import { SwapFieldsButton } from "./SwapFieldsButton";
import type { SearchCandidate } from "@/lib/services/place-resolution";
import { swapOriginAndDestination } from "@/lib/services/swap-origin-destination";
import { loadSearchFormDraft, saveSearchFormDraft } from "@/lib/search-form-persistence";

/**
 * 入れ替えロジック(swapOriginAndDestination)が要求する駅の完全情報フェッチ。
 * 対象駅が見つからない(404等)場合はApiErrorを握りつぶしnullを返す
 * — 呼び出し元はnullを「入れ替え不可」として扱う設計のため。
 */
async function fetchStation(stationId: string): Promise<Station | null> {
  try {
    const res = await apiFetch<{ station: Station }>(
      `/api/stations/${encodeURIComponent(stationId)}`
    );
    return res.station;
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

interface SearchFormProps {
  user: User | null;
  homeStation: Station | null;
  favoriteDestinations?: FavoriteDestination[];
}

export function SearchForm({ user, homeStation, favoriteDestinations = [] }: SearchFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft] = useState(() => loadSearchFormDraft());
  const [origin, setOrigin] = useState<OriginChoice | null>(
    draft?.origin ??
      (user && homeStation ? { type: "home_station", label: homeStation.stationName } : null)
  );
  const [destination, setDestination] = useState<SearchCandidate | null>(
    draft?.destination ?? null
  );
  const [mode, setMode] = useState<RouteMode>(draft?.mode ?? "easy");
  const [error, setError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);

  // 入れ替えAPIの待機中にユーザーが出発地/目的地を編集した場合、完了時に古い
  // (入れ替え開始時点の)結果で最新の選択を上書きしてしまう競合を防ぐため、
  // 常に最新のorigin/destinationを参照できるrefを保持する。
  const originRef = useRef(origin);
  const destinationRef = useRef(destination);

  useEffect(() => {
    originRef.current = origin;
    destinationRef.current = destination;
  }, [origin, destination]);

  useEffect(() => {
    saveSearchFormDraft({ origin, destination, mode });
  }, [origin, destination, mode]);

  async function handleSwap() {
    if (!origin || !destination || swapping) return;
    const originAtStart = origin;
    const destinationAtStart = destination;
    setSwapping(true);
    setSwapError(null);
    try {
      const result = await swapOriginAndDestination(
        originAtStart,
        destinationAtStart,
        homeStation,
        fetchStation
      );
      if (!result) {
        setSwapError("入れ替えに失敗しました");
        return;
      }
      if (originRef.current !== originAtStart || destinationRef.current !== destinationAtStart) {
        // 待機中に出発地/目的地の選択が変わっていた場合、片方だけ入れ替わる
        // 中途半端な状態を避けるため、古い結果は破棄してユーザーの最新選択を優先する。
        setSwapError("入れ替え中に選択内容が変更されたため中止しました");
        return;
      }
      setOrigin(result.newOrigin);
      setDestination(result.newDestination);
    } catch {
      setSwapError("入れ替えに失敗しました");
    } finally {
      setSwapping(false);
    }
  }

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

    startTransition(() => {
      router.push(`/routes/result?${params.toString()}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <OriginField user={user} homeStation={homeStation} value={origin} onChange={setOrigin} />
      <SwapFieldsButton
        isDisabled={!origin || !destination}
        isPending={swapping}
        onPress={handleSwap}
      />
      <DestinationField
        user={user}
        favoriteDestinations={favoriteDestinations}
        value={destination}
        onChange={setDestination}
      />
      {swapError ? <p className="text-sm text-[var(--danger)]">{swapError}</p> : null}
      <div>
        <span className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
          ルートモード
        </span>
        <RouteModeSelector value={mode} onChange={setMode} />
      </div>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      <Button type="submit" fullWidth size="lg" isDisabled={isPending}>
        {isPending ? "検索しています…" : "ルートを検索"}
      </Button>
    </form>
  );
}
