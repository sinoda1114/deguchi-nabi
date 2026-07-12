"use client";

import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { apiFetch } from "@/lib/api-client";

interface RemoveButtonProps {
  endpoint: string;
}

export function RemoveButton({ endpoint }: RemoveButtonProps) {
  const router = useRouter();

  async function handleRemove() {
    await apiFetch(endpoint, { method: "DELETE" });
    router.refresh();
  }

  return (
    <Button size="sm" variant="ghost" onPress={handleRemove} aria-label="削除">
      削除
    </Button>
  );
}
