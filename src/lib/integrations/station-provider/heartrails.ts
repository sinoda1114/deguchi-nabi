import type { Station } from "@/lib/domain/station";
import { FIXTURE_STATIONS } from "@/lib/fixtures/stations";
import { haversineMeters } from "@/lib/geo/haversine";

const HEARTRAILS_URL = "https://express.heartrails.com/api/json";
const REQUEST_TIMEOUT_MS = 5000;
const MAX_NAME_LENGTH = 50;
const MAX_LINE_NAME_LENGTH = 50;
const MAX_QUERY_LENGTH = 50;
const HR_ID_PREFIX = "hr_";
// fixtureの駅と同名でも、日本には同名の別駅が存在しうるため、
// 座標がこの距離以内の場合のみ同一駅とみなしfixtureのstationIdへ揃える。
const FIXTURE_MATCH_RADIUS_METERS = 1000;

interface HeartRailsEntry {
  name: string;
  prefecture: string;
  line: string;
  x: number;
  y: number;
}

interface HeartRailsResponse {
  response?: { station?: unknown[] };
}

function isValidEntry(e: unknown): e is HeartRailsEntry {
  if (typeof e !== "object" || e === null) return false;
  const c = e as Record<string, unknown>;
  return (
    typeof c.name === "string" &&
    c.name.trim().length > 0 &&
    c.name.length <= MAX_NAME_LENGTH &&
    typeof c.prefecture === "string" &&
    c.prefecture.length > 0 &&
    typeof c.line === "string" &&
    c.line.trim().length > 0 &&
    c.line.length <= MAX_LINE_NAME_LENGTH &&
    typeof c.x === "number" &&
    Number.isFinite(c.x) &&
    typeof c.y === "number" &&
    Number.isFinite(c.y)
  );
}

function findFixtureMatch(name: string, x: number, y: number): Station | null {
  const sameName = FIXTURE_STATIONS.find(
    (s) => s.stationName.replace(/駅$/, "") === name
  );
  if (!sameName) return null;
  const distance = haversineMeters(y, x, sameName.latitude, sameName.longitude);
  return distance <= FIXTURE_MATCH_RADIUS_METERS ? sameName : null;
}

function stationIdFor(name: string, x: number, y: number): string {
  const fixtureMatch = findFixtureMatch(name, x, y);
  if (fixtureMatch) return fixtureMatch.stationId;
  return `${HR_ID_PREFIX}${encodeURIComponent(name)}_${x.toFixed(4)}_${y.toFixed(4)}`;
}

/**
 * `hr_<駅名>_<経度>_<緯度>` 形式のstationIdから、駅名・座標のみを復元する。
 * nearestStations呼び出し時に書き出すJSONキャッシュ(路線名等の付加情報を含む)
 * が読み取り専用ファイルシステム等で失われても、stationId自体に必要最小限の
 * 情報が埋め込まれているため、getStationは常に解決できる(cacheは
 * 路線名等の充実化のためだけの最適化に留まる)。
 */
export function decodeHeartRailsStationId(stationId: string): Station | null {
  if (!stationId.startsWith(HR_ID_PREFIX)) return null;
  const rest = stationId.slice(HR_ID_PREFIX.length);
  const match = rest.match(/^(.+)_(-?\d+\.\d{4})_(-?\d+\.\d{4})$/);
  if (!match) return null;

  const [, encodedName, xStr, yStr] = match;
  const x = Number(xStr);
  const y = Number(yStr);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  let name: string;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    return null;
  }

  return {
    stationId,
    stationName: name.endsWith("駅") ? name : `${name}駅`,
    operator: "",
    lines: [],
    prefecture: "",
    latitude: y,
    longitude: x,
  };
}

/**
 * HeartRails Express API のレスポンスを Station[] に変換する共通処理。
 * 1駅につき乗り入れ路線ごとに1エントリが返るため、駅名+座標で
 * グルーピングしてStation[]に変換する。fixture(西谷・渋谷・新宿)と
 * 同名かつ近傍(1km以内)の駅は既存のstationIdに揃え、facility/boarding等の
 * 既存データと整合させる。事業者名(operator)はこのAPIから取得できないため
 * 空文字にする(誤った情報を作らない)。
 *
 * 個人運営サービスで可用性の保証が無いため、失敗時は必ずnullを返し、
 * 呼び出し側(CompositeStationAdapter)がfixtureにフォールバックする。
 */
async function fetchAndTransformStations(url: string): Promise<Station[] | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[DIAG3-heartrails] non-ok response: status=${res.status}`);
      return null;
    }

    const data = (await res.json()) as HeartRailsResponse;
    const entries = data.response?.station;
    if (!Array.isArray(entries)) {
      console.error(
        `[DIAG3-heartrails] entries not array: ${JSON.stringify(data).slice(0, 300)}`
      );
      return null;
    }

    const valid = entries.filter(isValidEntry);
    if (valid.length === 0) {
      console.error(
        `[DIAG3-heartrails] no valid entries, rawEntriesCount=${entries.length}, sample=${JSON.stringify(entries[0] ?? null)}`
      );
      return null;
    }

    const grouped = new Map<
      string,
      { name: string; prefecture: string; x: number; y: number; lines: Set<string> }
    >();
    for (const e of valid) {
      const key = `${e.name}_${e.x}_${e.y}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.lines.add(e.line);
      } else {
        grouped.set(key, {
          name: e.name,
          prefecture: e.prefecture,
          x: e.x,
          y: e.y,
          lines: new Set([e.line]),
        });
      }
    }

    // 大きい駅は出入口ごとに座標クラスタが分かれて複数エントリになる。
    // fixture既存駅への付け替えで同一stationIdになるケースがあるため、
    // 最終的なstationId単位でさらに統合する(距離順で最初に現れたものの
    // 座標を採用し、路線は和集合にする)。
    const merged = new Map<string, Station>();
    for (const g of grouped.values()) {
      const stationId = stationIdFor(g.name, g.x, g.y);
      const existing = merged.get(stationId);
      if (existing) {
        existing.lines = Array.from(new Set([...existing.lines, ...g.lines]));
      } else {
        merged.set(stationId, {
          stationId,
          stationName: g.name.endsWith("駅") ? g.name : `${g.name}駅`,
          operator: "",
          lines: Array.from(g.lines),
          prefecture: g.prefecture,
          latitude: g.y,
          longitude: g.x,
        });
      }
    }

    return Array.from(merged.values());
  } catch (e) {
    console.error(`[DIAG3-heartrails] fetch threw: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * HeartRails Express API(https://express.heartrails.com/api.html、無料・
 * クレジット表記必須)で緯度経度から最寄り駅をオンデマンドに取得する。
 * 全国駅マスタを事前にダウンロード・自前DB化しない方針のため、
 * リクエストの都度この無料APIに問い合わせる。
 */
export async function fetchNearestStationsFromHeartRails(
  latitude: number,
  longitude: number
): Promise<Station[] | null> {
  return fetchAndTransformStations(
    `${HEARTRAILS_URL}?method=getStations&x=${longitude}&y=${latitude}`
  );
}

/**
 * HeartRails Express API の name パラメータ(部分一致)で駅名から検索する。
 * fixture(西谷・渋谷・新宿)以外の駅を手入力で検索できるようにするために使う
 * (searchStations はこれまでfixture収録駅しか見つけられなかった)。
 */
export async function searchStationsFromHeartRails(query: string): Promise<Station[] | null> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > MAX_QUERY_LENGTH) return null;
  return fetchAndTransformStations(
    `${HEARTRAILS_URL}?method=getStations&name=${encodeURIComponent(trimmed)}`
  );
}
