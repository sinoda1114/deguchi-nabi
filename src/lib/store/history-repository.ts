import { randomUUID } from "node:crypto";
import type { SearchHistoryEntry } from "@/lib/domain/user";
import { readCollection, writeCollection } from "./json-file-store";

const COLLECTION = "history";
const MAX_ENTRIES_PER_USER = 50;

export function listHistory(userId: string): SearchHistoryEntry[] {
  return readCollection<SearchHistoryEntry>(COLLECTION)
    .filter((h) => h.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addHistoryEntry(
  entry: Omit<SearchHistoryEntry, "historyId" | "createdAt">
): SearchHistoryEntry {
  const history = readCollection<SearchHistoryEntry>(COLLECTION);
  const created: SearchHistoryEntry = {
    ...entry,
    historyId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const others = history.filter((h) => h.userId !== entry.userId);
  const mine = [created, ...history.filter((h) => h.userId === entry.userId)].slice(
    0,
    MAX_ENTRIES_PER_USER
  );
  writeCollection(COLLECTION, [...others, ...mine]);
  return created;
}

export function removeHistoryEntry(userId: string, historyId: string): void {
  const history = readCollection<SearchHistoryEntry>(COLLECTION);
  writeCollection(
    COLLECTION,
    history.filter((h) => !(h.userId === userId && h.historyId === historyId))
  );
}
