"use client";

import { useRouter } from "next/navigation";
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
    <button
      type="button"
      onClick={handleRemove}
      aria-label="削除"
      className="rounded-full px-2 py-1 text-xs font-bold text-[var(--foreground-muted)] hover:text-[var(--confidence-low-fg)]"
    >
      削除
    </button>
  );
}
