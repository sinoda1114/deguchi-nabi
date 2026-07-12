"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] py-2.5 text-center text-sm font-bold text-[var(--foreground)] hover:border-[var(--confidence-low-fg)]"
    >
      ログアウト
    </button>
  );
}
