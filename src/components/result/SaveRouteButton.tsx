"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { apiFetch } from "@/lib/api-client";
import type { RouteMode } from "@/lib/domain/route";

interface SaveRouteButtonProps {
  routeGuideId: string;
  label: string;
  originStationId: string;
  destinationStationId: string;
  mode: RouteMode;
}

export function SaveRouteButton({
  routeGuideId,
  label,
  originStationId,
  destinationStationId,
  mode,
}: SaveRouteButtonProps) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch("/api/favorites", {
        method: "POST",
        body: JSON.stringify({
          routeGuideId,
          label,
          query: { originStationId, destinationStationId, mode },
        }),
      });
      setSaved(true);
    } catch {
      // 保存失敗時はボタンの状態を戻し、再試行できるようにする
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      onPress={handleSave}
      isDisabled={saved || saving}
      isPending={saving}
    >
      {saved ? "保存済み" : saving ? "保存中…" : "ルートを保存"}
    </Button>
  );
}
