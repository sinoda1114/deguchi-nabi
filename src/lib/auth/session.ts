import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { readCollection, writeCollection } from "@/lib/store/json-file-store";
import { getUserById } from "@/lib/store/user-repository";
import type { User } from "@/lib/domain/user";

const COLLECTION = "sessions";
const COOKIE_NAME = "deguchi_nabi_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionRecord {
  sessionId: string;
  userId: string;
  expiresAt: string;
}

export async function createSession(userId: string): Promise<void> {
  const sessions = readCollection<SessionRecord>(COLLECTION);
  const session: SessionRecord = {
    sessionId: randomUUID(),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  writeCollection(COLLECTION, [...sessions, session]);

  const store = await cookies();
  store.set(COOKIE_NAME, session.sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const sessionId = store.get(COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const sessions = readCollection<SessionRecord>(COLLECTION);
  const session = sessions.find((s) => s.sessionId === sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;

  return getUserById(session.userId);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(COOKIE_NAME)?.value;
  if (sessionId) {
    const sessions = readCollection<SessionRecord>(COLLECTION);
    writeCollection(
      COLLECTION,
      sessions.filter((s) => s.sessionId !== sessionId)
    );
  }
  store.delete(COOKIE_NAME);
}
