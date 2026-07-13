"use client";

import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { apiFetch } from "@/lib/api-client";
import { splitForDisclosure } from "@/lib/services/progressive-disclosure";
import { SearchPictogram } from "./SearchPictogram";
import type { Station } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";

export type OriginChoice =
  | { type: "home_station"; label: string }
  | { type: "station"; stationId: string; label: string };

/**
 * 「実効ホーム駅」ボタン(ログイン時は登録駅、未ログイン時はlocalStorageの
 * デフォルト駅)を押した際の OriginChoice を組み立てる。
 *
 * type: "home_station" は、サーバー側 resolveOriginDestination が
 * 「ログインユーザーのDB登録済み最寄り駅(sessionUser.homeStationId)」
 * としてのみ解釈できる値であり、未ログイン時にこれを送ると sessionUser
 * が無いため「最寄り駅が登録されていません」エラーになる。未ログイン時は
 * 具体的な stationId が判明しているため、代わりに type: "station" として
 * 送る(サーバー側はstation型ならログイン状態を問わずそのまま解決できる)。
 */
export function buildHomeStationOriginChoice(
  user: User | null,
  station: Station
): OriginChoice {
  if (user) {
    return { type: "home_station", label: station.stationName };
  }
  return { type: "station", stationId: station.stationId, label: station.stationName };
}

/**
 * 出発地入力欄に表示する文字列を決定する。
 * home_station選択時は、sessionStorageの下書きに保存された選択時点の
 * ラベル(古い登録駅名の可能性がある)より、常に最新のeffectiveHomeStation
 * (ログイン時はhomeStation props、未ログイン時はlocalStorageのデフォルト駅)
 * を優先する(/settingsで最寄り駅を変更しても表示が追従するように)。
 */
export function resolveOriginInputValue(
  value: OriginChoice | null,
  effectiveHomeStation: Station | null,
  manualQuery: string
): string {
  if (!value) return manualQuery;
  if (value.type === "home_station") return effectiveHomeStation?.stationName ?? value.label;
  return value.label;
}

interface OriginFieldProps {
  user: User | null;
  homeStation: Station | null;
  value: OriginChoice | null;
  onChange: (choice: OriginChoice | null) => void;
  /**
   * 未ログイン時のデフォルト出発駅(この端末にlocalStorage保存)。ログイン時のhomeStationと
   * 実質的に同じ役割を果たす。SearchForm側で一元管理し、propsとして受け取ることで、
   * このコンポーネント内で設定した変更を目的地検索の位置バイアス計算にも即座に反映させる。
   */
  localDefaultStation: Station | null;
  onSetLocalDefaultStation: (station: Station) => void;
}

// 周辺駅候補は距離順(近い順)で返る(CompositeStationAdapter.nearestStations参照)。
// ヒックの法則(選択肢が多いほど意思決定が遅くなる)を踏まえ、最有力の先頭2件だけを自動露出し、
// 残りは「もっと見る」で展開する progressive disclosure にする。
const NEARBY_PRIMARY_COUNT = 2;

export function OriginField({
  user,
  homeStation,
  value,
  onChange,
  localDefaultStation,
  onSetLocalDefaultStation,
}: OriginFieldProps) {
  const [manualQuery, setManualQuery] = useState("");
  const [manualCandidates, setManualCandidates] = useState<Station[]>([]);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Station[]>([]);
  const [showAllNearby, setShowAllNearby] = useState(false);

  // ログイン中はサーバーに登録された最寄り駅、未ログイン中はこの端末に保存した
  // デフォルト駅を、実質的に同じ役割(出発地のワンタップ選択肢)として扱う。
  const effectiveHomeStation = user ? homeStation : localDefaultStation;

  async function handleUseCurrentLocation() {
    setLocationError(null);
    setLocating(true);
    setShowAllNearby(false);
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
    onChange(null);
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

  const { primary: primaryNearby, more: moreNearby } = splitForDisclosure(
    nearby,
    NEARBY_PRIMARY_COUNT
  );
  const visibleNearby = showAllNearby ? nearby : primaryNearby;

  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-bold text-[var(--foreground-muted)]">
        <SearchPictogram type="origin" className="h-3.5 w-3.5" />
        出発地
      </label>
      <div className="flex flex-wrap gap-2">
        {effectiveHomeStation ? (
          <Button
            size="sm"
            variant={
              value?.type === "home_station" ||
              (value?.type === "station" && value.stationId === effectiveHomeStation.stationId)
                ? "primary"
                : "secondary"
            }
            onPress={() => onChange(buildHomeStationOriginChoice(user, effectiveHomeStation))}
          >
            {effectiveHomeStation.stationName}({user ? "登録駅" : "出発地"})
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          isPending={locating}
          onPress={handleUseCurrentLocation}
        >
          <SearchPictogram type="current-location" className="h-3.5 w-3.5" />
          {locating ? "取得中…" : "現在地を使用"}
        </Button>
      </div>

      {locationError ? (
        <p className="mt-1 text-xs text-[var(--danger)]">{locationError}</p>
      ) : null}

      {nearby.length > 0 ? (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {visibleNearby.map((station) => (
              <div key={station.stationId} className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={
                    value?.type === "station" && value.stationId === station.stationId
                      ? "primary"
                      : "secondary"
                  }
                  onPress={() => {
                    onChange({ type: "station", stationId: station.stationId, label: station.stationName });
                    setManualCandidates([]);
                  }}
                >
                  {station.stationName}
                </Button>
                {!user ? (
                  <button
                    type="button"
                    onClick={() => onSetLocalDefaultStation(station)}
                    disabled={localDefaultStation?.stationId === station.stationId}
                    aria-label={
                      localDefaultStation?.stationId === station.stationId
                        ? "出発地に設定済み"
                        : "この駅を出発地にする"
                    }
                    aria-pressed={localDefaultStation?.stationId === station.stationId}
                    className="shrink-0 p-1 disabled:cursor-default"
                  >
                    <SearchPictogram
                      type="favorite"
                      filled={localDefaultStation?.stationId === station.stationId}
                      className={`h-4 w-4 ${localDefaultStation?.stationId === station.stationId ? "text-[var(--accent)]" : "text-[var(--foreground-muted)]"}`}
                    />
                  </button>
                ) : null}
              </div>
            ))}
            {!showAllNearby && moreNearby.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={showAllNearby}
                onPress={() => setShowAllNearby(true)}
              >
                もっと見る({moreNearby.length}件)
              </Button>
            ) : null}
          </div>
          <p className="mt-1 text-[10px] text-[var(--foreground-muted)]">
            周辺駅情報:{" "}
            <a
              href="https://express.heartrails.com/api.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              HeartRails Express
            </a>
          </p>
        </>
      ) : null}

      <div className="relative mt-2">
        <Input
          type="text"
          value={resolveOriginInputValue(value, effectiveHomeStation, manualQuery)}
          placeholder="駅名で指定"
          aria-label="出発駅を検索"
          onChange={(e) => handleManualSearch(e.target.value)}
        />
        {!value && manualCandidates.length > 0 ? (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-lg">
            {manualCandidates.map((station) => (
              <li key={station.stationId} className="flex items-center gap-1 hover:bg-[var(--surface-raised)]">
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      type: "station",
                      stationId: station.stationId,
                      label: station.stationName,
                    });
                    setManualCandidates([]);
                  }}
                  className="flex-1 px-3 py-2 text-left text-sm"
                >
                  {station.stationName}
                </button>
                {!user ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetLocalDefaultStation(station);
                    }}
                    disabled={localDefaultStation?.stationId === station.stationId}
                    aria-label={
                      localDefaultStation?.stationId === station.stationId
                        ? "出発地に設定済み"
                        : "この駅を出発地にする"
                    }
                    aria-pressed={localDefaultStation?.stationId === station.stationId}
                    className="mr-2 shrink-0 p-1 disabled:cursor-default"
                  >
                    <SearchPictogram
                      type="favorite"
                      filled={localDefaultStation?.stationId === station.stationId}
                      className={`h-4 w-4 ${localDefaultStation?.stationId === station.stationId ? "text-[var(--accent)]" : "text-[var(--foreground-muted)]"}`}
                    />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
