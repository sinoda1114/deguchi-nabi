import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * MVP用の簡易永続化。単一プロセスのローカル開発を想定したファイルベース JSON ストア。
 * 正式版では DB (packages/domain のリポジトリ実装) へ置き換える前提(03_STRUCTURE.md §16)。
 */
const DATA_DIR = join(process.cwd(), "data");

function filePath(name: string): string {
  return join(DATA_DIR, `${name}.json`);
}

export function readCollection<T>(name: string): T[] {
  const path = filePath(name);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  if (!raw.trim()) return [];
  return JSON.parse(raw) as T[];
}

export function writeCollection<T>(name: string, items: T[]): void {
  const path = filePath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(items, null, 2), "utf-8");
}
