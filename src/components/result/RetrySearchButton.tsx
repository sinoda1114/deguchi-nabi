"use client";

import { useRouter } from "next/navigation";

/**
 * 経路検索エラー画面用の再試行ボタン。
 *
 * AI検索(Gemini Search Grounding)は最大55秒のタイムアウトを持ち、一時的な
 * タイムアウトやAPI障害で失敗することがある。生成失敗はキャッシュされない設計
 * (CompositeRouteAdapter.ts参照)のため、同じURL(=同じ検索条件)に再アクセスすれば
 * 成功する可能性がある。Server Componentのままではクライアント側の再取得操作が
 * できないため、この小さなClient Componentに切り出している。
 */
export function RetrySearchButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="rounded-[var(--radius-pill)] border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--foreground-muted)] hover:border-[var(--accent)] hover:text-[var(--foreground)]"
    >
      もう一度検索
    </button>
  );
}
