import type { Destination, Station } from "@/lib/domain/station";
import type { FavoriteDestination } from "@/lib/domain/user";
import type { FavoriteDestinationInput } from "./place-resolution";

const STORAGE_KEY = "deguchi-nabi:local-favorite-destinations";
/** 未ログインユーザーのローカル保存分を表す疑似userId。サーバー側のuserIdとは無関係。 */
export const LOCAL_USER_ID = "local";
// サーバー側(MAX_FAVORITES_PER_USER)と揃え、際限のない蓄積を防ぐ。
const MAX_LOCAL_FAVORITES = 20;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isSameTarget(existing: FavoriteDestination, input: FavoriteDestinationInput): boolean {
  if (existing.kind === "station" && input.kind === "station") {
    return existing.station.stationId === input.station.stationId;
  }
  if (existing.kind === "place" && input.kind === "place") {
    return existing.destination.destinationId === input.destination.destinationId;
  }
  return false;
}

function isValidStation(value: unknown): value is Station {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.stationId === "string" &&
    typeof s.stationName === "string" &&
    typeof s.operator === "string" &&
    Array.isArray(s.lines) &&
    typeof s.prefecture === "string" &&
    typeof s.latitude === "number" &&
    typeof s.longitude === "number"
  );
}

function isValidDestination(value: unknown): value is Destination {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.destinationId === "string" &&
    typeof d.name === "string" &&
    typeof d.category === "string" &&
    typeof d.address === "string" &&
    typeof d.latitude === "number" &&
    typeof d.longitude === "number" &&
    Array.isArray(d.nearestStationCandidates)
  );
}

/**
 * localStorageはユーザー本人が自由に書き換えられる領域のため、パースが通っても
 * 中身の形が壊れている可能性がある(手動編集・別バージョンの残骸等)。
 * サーバー側APIと同じ形の検証をここでも行い、不正な要素は読み捨てる。
 */
function isValidFavoriteDestination(value: unknown): value is FavoriteDestination {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  if (
    typeof f.favoriteDestinationId !== "string" ||
    typeof f.userId !== "string" ||
    typeof f.label !== "string" ||
    typeof f.createdAt !== "string"
  ) {
    return false;
  }
  if (f.kind === "station") return isValidStation(f.station);
  if (f.kind === "place") return isValidDestination(f.destination);
  return false;
}

/** 未ログイン時のお気に入り目的地一覧をlocalStorageから読み出す。SSR実行時は空配列を返す。 */
export function listLocalFavoriteDestinations(): FavoriteDestination[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 不正な要素の除去、上限件数の強制の両方を兼ねる(手動編集された場合の保険)。
    return parsed.filter(isValidFavoriteDestination).slice(0, MAX_LOCAL_FAVORITES);
  } catch {
    // 壊れた/古い形式のデータが残っていても致命的にせず空扱いにする
    return [];
  }
}

function saveAll(favorites: FavoriteDestination[]): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    return true;
  } catch {
    // 容量超過・プライベートモード制限等。呼び出し元がfalseを見てUIにエラーを出す。
    return false;
  }
}

export type AddLocalFavoriteResult =
  | { ok: true; favoriteDestination: FavoriteDestination }
  | { ok: false; reason: "limit_exceeded" | "storage_error" };

/**
 * 同じ駅・施設が既に登録済みなら新規追加せず既存レコードを返す(サーバー側addFavoriteDestinationと同じ重複防止方針)。
 */
export function addLocalFavoriteDestination(input: FavoriteDestinationInput): AddLocalFavoriteResult {
  const favorites = listLocalFavoriteDestinations();
  const existing = favorites.find((f) => isSameTarget(f, input));
  if (existing) return { ok: true, favoriteDestination: existing };
  if (favorites.length >= MAX_LOCAL_FAVORITES) return { ok: false, reason: "limit_exceeded" };

  const base = {
    favoriteDestinationId: crypto.randomUUID(),
    userId: LOCAL_USER_ID,
    createdAt: new Date().toISOString(),
  };
  const favorite: FavoriteDestination =
    input.kind === "station"
      ? { ...base, kind: "station", station: input.station, label: input.label }
      : { ...base, kind: "place", destination: input.destination, label: input.label };

  if (!saveAll([...favorites, favorite])) {
    return { ok: false, reason: "storage_error" };
  }
  return { ok: true, favoriteDestination: favorite };
}

export function removeLocalFavoriteDestination(favoriteDestinationId: string): void {
  saveAll(listLocalFavoriteDestinations().filter((f) => f.favoriteDestinationId !== favoriteDestinationId));
}

/** ログイン後にサーバー側へ移行し終えたローカル保存分を消す。 */
export function clearLocalFavoriteDestinations(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}
