import { randomUUID } from "node:crypto";
import type { Feedback, FeedbackStatus } from "@/lib/domain/feedback";
import { readCollection, writeCollection } from "./json-file-store";

const COLLECTION = "feedback";

export function listFeedback(status?: FeedbackStatus): Feedback[] {
  const all = readCollection<Feedback>(COLLECTION);
  return status ? all.filter((f) => f.status === status) : all;
}

export function createFeedback(
  input: Omit<Feedback, "feedbackId" | "status" | "createdAt">
): Feedback {
  const all = readCollection<Feedback>(COLLECTION);
  const feedback: Feedback = {
    ...input,
    feedbackId: randomUUID(),
    status: "received",
    createdAt: new Date().toISOString(),
  };
  writeCollection(COLLECTION, [...all, feedback]);
  return feedback;
}

export function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus
): Feedback | null {
  const all = readCollection<Feedback>(COLLECTION);
  const idx = all.findIndex((f) => f.feedbackId === feedbackId);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], status };
  writeCollection(COLLECTION, all);
  return all[idx];
}
