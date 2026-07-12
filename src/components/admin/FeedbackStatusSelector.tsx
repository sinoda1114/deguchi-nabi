"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { FeedbackStatus } from "@/lib/domain/feedback";

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  received: "受付",
  under_review: "確認中",
  verified: "確認済み",
  rejected: "却下",
  published: "反映済み",
};

const STATUSES = Object.keys(STATUS_LABEL) as FeedbackStatus[];

interface FeedbackStatusSelectorProps {
  feedbackId: string;
  status: FeedbackStatus;
}

export function FeedbackStatusSelector({ feedbackId, status }: FeedbackStatusSelectorProps) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);

  async function handleChange(next: FeedbackStatus) {
    setUpdating(true);
    try {
      await apiFetch(`/api/admin/feedback/${feedbackId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } finally {
      setUpdating(false);
    }
  }

  return (
    <select
      value={status}
      disabled={updating}
      onChange={(e) => handleChange(e.target.value as FeedbackStatus)}
      className="rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
