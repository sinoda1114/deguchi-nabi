import { randomUUID } from "node:crypto";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@/lib/domain/user";
import { readCollection, writeCollection } from "./json-file-store";

interface StoredUser extends User {
  passwordHash: string;
  passwordSalt: string;
}

const COLLECTION = "users";

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function createUser(email: string, password: string): User {
  const users = readCollection<StoredUser>(COLLECTION);
  if (users.some((u) => u.email === email)) {
    throw new Error("既にこのメールアドレスは登録されています");
  }
  const salt = randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const user: StoredUser = {
    userId: randomUUID(),
    email,
    displayName: email.split("@")[0],
    homeStationId: null,
    plan: "free",
    locale: "ja",
    createdAt: now,
    updatedAt: now,
    passwordHash: hashPassword(password, salt),
    passwordSalt: salt,
  };
  writeCollection(COLLECTION, [...users, user]);
  return toPublicUser(user);
}

export function verifyUser(email: string, password: string): User | null {
  const users = readCollection<StoredUser>(COLLECTION);
  const user = users.find((u) => u.email === email);
  if (!user) return null;
  const hash = hashPassword(password, user.passwordSalt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(user.passwordHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return toPublicUser(user);
}

export function getUserById(userId: string): User | null {
  const users = readCollection<StoredUser>(COLLECTION);
  const user = users.find((u) => u.userId === userId);
  return user ? toPublicUser(user) : null;
}

export function setHomeStation(userId: string, stationId: string): User | null {
  const users = readCollection<StoredUser>(COLLECTION);
  const idx = users.findIndex((u) => u.userId === userId);
  if (idx === -1) return null;
  users[idx] = {
    ...users[idx],
    homeStationId: stationId,
    updatedAt: new Date().toISOString(),
  };
  writeCollection(COLLECTION, users);
  return toPublicUser(users[idx]);
}

function toPublicUser(user: StoredUser): User {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    homeStationId: user.homeStationId,
    plan: user.plan,
    locale: user.locale,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
