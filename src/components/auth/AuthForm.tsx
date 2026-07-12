"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@heroui/react";
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
        <Button
          fullWidth
          variant={mode === "login" ? "primary" : "secondary"}
          onPress={() => setMode("login")}
        >
          ログイン
        </Button>
        <Button
          fullWidth
          variant={mode === "register" ? "primary" : "secondary"}
          onPress={() => setMode("register")}
        >
          新規登録
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス"
          aria-label="メールアドレス"
        />
        <Input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード(8文字以上)"
          aria-label="パスワード"
        />

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

        <Button type="submit" isPending={submitting} fullWidth>
          {submitting ? "処理中…" : mode === "login" ? "ログイン" : "登録する"}
        </Button>
      </form>
    </div>
  );
}
