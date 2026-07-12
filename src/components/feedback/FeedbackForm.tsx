"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { FEEDBACK_CATEGORY_LABEL, type FeedbackCategory } from "@/lib/domain/feedback";

const CATEGORIES = Object.keys(FEEDBACK_CATEGORY_LABEL) as FeedbackCategory[];

interface FeedbackFormProps {
  routeGuideId: string;
}

export function FeedbackForm({ routeGuideId }: FeedbackFormProps) {
  const router = useRouter();
  const [category, setCategory] = useState<FeedbackCategory>("wrong_exit");
  const [targetEntity, setTargetEntity] = useState("");
  const [reportedValue, setReportedValue] = useState("");
  const [suggestedValue, setSuggestedValue] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetEntity.trim()) {
      setError("対象のステップ・箇所を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          routeGuideId,
          category,
          targetEntity,
          reportedValue: reportedValue || null,
          suggestedValue: suggestedValue || null,
          comment: comment || null,
        }),
      });
      setDone(true);
      setTimeout(() => router.push("/"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 text-center text-sm font-semibold">
        報告を受け付けました。ご協力ありがとうございます。
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
          問題カテゴリ
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {FEEDBACK_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
          対象のステップ・箇所
        </label>
        <input
          value={targetEntity}
          onChange={(e) => setTargetEntity(e.target.value)}
          placeholder="例: 渋谷駅 B5出口"
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
          現在表示されている情報(任意)
        </label>
        <input
          value={reportedValue}
          onChange={(e) => setReportedValue(e.target.value)}
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
          正しいと思う情報(任意)
        </label>
        <input
          value={suggestedValue}
          onChange={(e) => setSuggestedValue(e.target.value)}
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold text-[var(--foreground-muted)]">
          コメント(任意)
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          className="w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
        />
      </div>

      {error ? <p className="text-sm text-[var(--confidence-low-fg)]">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-[var(--radius-card)] bg-[var(--brand)] py-3 text-center font-bold text-[var(--brand-contrast)] disabled:opacity-60"
      >
        {submitting ? "送信中…" : "報告を送信"}
      </button>
    </form>
  );
}
