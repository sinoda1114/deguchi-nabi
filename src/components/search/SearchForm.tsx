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
import { toSearchCandidate } from "@/lib/services/place-resolution";
import { swapOriginAndDestination } from "@/lib/services/swap-origin-destination";
import { loadSearchFormDraft, saveSearchFormDraft } from "@/lib/search-form-persistence";
import {
  listLocalFavoriteDestinations,
  removeLocalFavoriteDestination,
} from "@/lib/services/local-favorite-destinations";
import {
  getLocalDefaultOriginStation,
  setLocalDefaultOriginStation as persistLocalDefaultOriginStation,
} from "@/lib/services/local-default-origin-station";

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
  const [localDefaultOriginStation, setLocalDefaultOriginStation] = useState<Station | null>(null);

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

  // 未ログイン中のみ、SSRでは取得できないlocalStorage(外部システム)のデフォルト出発駅を
  // ここで取り込む。下書き(draft)も無く出発地が未選択なら、ログイン時のhomeStationと同様に
  // 自動選択する。マウント時とログイン検知時にのみ実行すればよいため依存配列はuserのみ。
  useEffect(() => {
    if (user) return;
    const defaultStation = getLocalDefaultOriginStation();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部システム(localStorage)との同期
    setLocalDefaultOriginStation(defaultStation);
    if (!origin && defaultStation) {
      setOrigin({ type: "home_station", label: defaultStation.stationName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const effectiveHomeStation = user ? homeStation : localDefaultOriginStation;

  function handleSetLocalDefaultOriginStation(station: Station) {
    if (persistLocalDefaultOriginStation(station)) {
      setLocalDefaultOriginStation(station);
    }
  }

  // 未ログイン中にlocalStorageへ貯めたお気に入りは、ログイン検知時に一度だけ
  // サーバー側へ移行する。成功した項目だけを個別にlocalStorageから取り除くため、
  // 移行に失敗した項目や、移行処理の最中に別画面から追加された項目は消えずに残る。
  const migratedLocalFavoritesRef = useRef(false);
  useEffect(() => {
    if (!user || migratedLocalFavoritesRef.current) return;
    const local = listLocalFavoriteDestinations();
    if (local.length === 0) return;
    migratedLocalFavoritesRef.current = true;
    (async () => {
      for (const favorite of local) {
        try {
          await apiFetch("/api/favorite-destinations", {
            method: "POST",
            body: JSON.stringify({ candidate: toSearchCandidate(favorite) }),
          });
          removeLocalFavoriteDestination(favorite.favoriteDestinationId);
        } catch {
          // 個別の失敗は無視して次へ進める。移行できなかった分はlocalStorageに残す。
        }
      }
      router.refresh();
    })();
  }, [user, router]);

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
      <OriginField
        user={user}
        homeStation={homeStation}
        value={origin}
        onChange={setOrigin}
        localDefaultStation={localDefaultOriginStation}
        onSetLocalDefaultStation={handleSetLocalDefaultOriginStation}
      />
      <SwapFieldsButton
        isDisabled={!origin || !destination}
        isPending={swapping}
        onPress={handleSwap}
      />
      {/*
        目的地検索の位置バイアスは常に「実効ホーム駅」(ログイン時はhomeStation、未ログイン時は
        この端末のデフォルト出発駅)の座標を使う。origin が現在地/他駅選択でも追従はしない
        近似(現在地座標は都度取得しておらずここでは扱えない)が、多くの場合出発地はこの駅で
        あり、無バイアス(全国検索)よりは大幅に精度が上がるため許容する。
      */}
      <DestinationField
        user={user}
        favoriteDestinations={favoriteDestinations}
        value={destination}
        onChange={setDestination}
        originCoordinates={
          effectiveHomeStation
            ? { lat: effectiveHomeStation.latitude, lng: effectiveHomeStation.longitude }
            : null
        }
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
