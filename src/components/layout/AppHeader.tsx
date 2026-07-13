import Link from "next/link";
import type { User } from "@/lib/domain/user";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

interface AppHeaderProps {
  user: User | null;
}

/**
 * ヘッダーの各リンクは全ページ(検索結果画面含む)に常時表示されるため、
 * デフォルトのprefetch(ビューポート進入時に自動でRSCペイロードを先読み)を
 * 有効にしたままだと、検索結果ページの本来のナビゲーション(origin/destination
 * 解決・経路探索)と同時に複数のprefetchリクエストが競合しうる。ヘッダーの
 * リンクは頻繁にクリックされるものではないため、prefetch={false}にして
 * クリック時にのみ取得する(体験改善の一環)。
 */
export function AppHeader({ user }: AppHeaderProps) {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
        <Link
          href="/"
          prefetch={false}
          className="text-lg font-black tracking-tight text-[var(--accent)]"
        >
          でぐちなび
        </Link>
        <nav className="flex items-center gap-3 text-sm font-semibold">
          <ThemeToggle />
          <Link
            href="/favorites/destinations"
            prefetch={false}
            className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
          >
            登録した行き先
          </Link>
          {user ? (
            <>
              <Link
                href="/favorites"
                prefetch={false}
                className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                保存したルート
              </Link>
              <Link
                href="/history"
                prefetch={false}
                className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                履歴
              </Link>
              <Link
                href="/settings"
                prefetch={false}
                className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                設定
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              prefetch={false}
              className="rounded-[var(--radius-pill)] bg-[var(--accent)] px-3 py-1.5 text-[var(--accent-foreground)]"
            >
              ログイン
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
