"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push(mode === "register" ? "/onboarding" : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`rounded-[var(--radius-card)] border py-2 text-sm font-bold ${
            mode === "login"
              ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
              : "border-[var(--border)] bg-[var(--surface)]"
          }`}
        >
          ログイン
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          className={`rounded-[var(--radius-card)] border py-2 text-sm font-bold ${
            mode === "register"
              ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
              : "border-[var(--border)] bg-[var(--surface)]"
          }`}
        >
          新規登録
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス"
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
        />
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード(8文字以上)"
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
        />

        {error ? <p className="text-sm text-[var(--confidence-low-fg)]">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-[var(--radius-card)] bg-[var(--brand)] py-3 text-center font-bold text-[var(--brand-contrast)] disabled:opacity-60"
        >
          {submitting ? "処理中…" : mode === "login" ? "ログイン" : "登録する"}
        </button>
      </form>
    </div>
  );
}
