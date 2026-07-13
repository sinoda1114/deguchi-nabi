import type { Station } from "@/lib/domain/station";

const STORAGE_KEY = "deguchi-nabi:local-default-origin-station";

function isBrowser(): boolean {
  return typeof window !== "undefined";
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

/** 未ログイン時のデフォルト出発駅(単一)をlocalStorageから読み出す。SSR実行時・未設定時はnullを返す。 */
export function getLocalDefaultOriginStation(): Station | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidStation(parsed) ? parsed : null;
  } catch {
    // 壊れた/古い形式のデータが残っていても致命的にせずnull扱いにする
    return null;
  }
}

/** デフォルト出発駅を設定する(単一スロット、既存の設定は上書きされる)。 */
export function setLocalDefaultOriginStation(station: Station): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(station));
    return true;
  } catch {
    // 容量超過・プライベートモード制限等
    return false;
  }
}

export function clearLocalDefaultOriginStation(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}
