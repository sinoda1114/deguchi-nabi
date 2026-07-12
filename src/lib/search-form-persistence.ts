import type { RouteMode } from "@/lib/domain/route";
import type { SearchCandidate } from "@/lib/services/place-resolution";
import type { OriginChoice } from "@/components/search/OriginField";

export interface SearchFormDraft {
  origin: OriginChoice | null;
  destination: SearchCandidate | null;
  mode: RouteMode;
}

const STORAGE_KEY = "deguchi-nabi:search-form-draft";

export function loadSearchFormDraft(): SearchFormDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SearchFormDraft;
  } catch {
    return null;
  }
}

export function saveSearchFormDraft(draft: SearchFormDraft): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}
