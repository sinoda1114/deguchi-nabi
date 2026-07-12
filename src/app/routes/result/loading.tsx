import Link from "next/link";
import { SearchingIndicator } from "./SearchingIndicator";

export default function ResultLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-black tracking-tight text-[var(--accent)]">
            でぐちなび
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-10">
        <div
          aria-hidden="true"
          className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--border)] border-t-[var(--accent)]"
        />
        <SearchingIndicator />
      </main>
    </div>
  );
}
