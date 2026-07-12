"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Key } from "@heroui/react";
import { ListBox, Select } from "@heroui/react";
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
    <Select
      className="w-36"
      value={status}
      isDisabled={updating}
      aria-label="フィードバックのステータス"
      onChange={(value: Key | null) => value && handleChange(value as FeedbackStatus)}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {STATUSES.map((s) => (
            <ListBox.Item key={s} id={s} textValue={STATUS_LABEL[s]}>
              {STATUS_LABEL[s]}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
