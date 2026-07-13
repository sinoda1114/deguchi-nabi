"use client";

import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { apiFetch } from "@/lib/api-client";

interface RemoveButtonProps {
  /** APIエンドポイントを指定するとDELETEを叩いてrouter.refresh()する(ログイン中のサーバー保存分)。 */
  endpoint?: string;
  /** endpointの代わりにコールバックで削除を行う(未ログイン中のlocalStorage保存分)。 */
  onRemove?: () => void;
}

export function RemoveButton({ endpoint, onRemove }: RemoveButtonProps) {
  const router = useRouter();

  async function handleRemove() {
    if (endpoint) {
      await apiFetch(endpoint, { method: "DELETE" });
      router.refresh();
      return;
    }
    onRemove?.();
  }

  return (
    <Button size="sm" variant="ghost" onPress={handleRemove} aria-label="削除">
      削除
    </Button>
  );
}
