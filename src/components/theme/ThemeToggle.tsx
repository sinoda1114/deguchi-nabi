"use client";

/**
 * 現在のテーマはReact stateで持たず、data-theme属性に応じたCSS表示切替のみで
 * アイコンを出し分ける(globals.cssの.theme-icon-*参照)。SSRとの
 * hydrationミスマッチや、DOM読み取りをuseEffectでstateに同期する
 * アンチパターンを避けるため。
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // 保存できない環境(プライベートモード等)でも、表示中のページ内では切替を維持する。
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="ライト/ダークモードを切り替え"
      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border)] text-[var(--foreground-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--foreground)]"
    >
      <svg
        className="theme-icon-light"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M20.7 15.2a8.7 8.7 0 0 1-10.9-10.9 9 9 0 1 0 10.9 10.9Z" />
      </svg>
      <svg
        className="theme-icon-dark"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}
