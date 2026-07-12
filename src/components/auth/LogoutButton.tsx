"use client";

import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { apiFetch } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <Button variant="secondary" fullWidth onPress={handleLogout}>
      ログアウト
    </Button>
  );
}
