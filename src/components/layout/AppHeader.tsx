import Link from "next/link";
import type { User } from "@/lib/domain/user";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

interface AppHeaderProps {
  user: User | null;
}

export function AppHeader({ user }: AppHeaderProps) {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-black tracking-tight text-[var(--accent)]">
          でぐちなび
        </Link>
        <nav className="flex items-center gap-3 text-sm font-semibold">
          <ThemeToggle />
          <Link
            href="/favorites/destinations"
            className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
          >
            登録した行き先
          </Link>
          {user ? (
            <>
              <Link href="/favorites" className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
                保存したルート
              </Link>
              <Link href="/history" className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
                履歴
              </Link>
              <Link href="/settings" className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
                設定
              </Link>
            </>
          ) : (
            <Link
              href="/login"
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
