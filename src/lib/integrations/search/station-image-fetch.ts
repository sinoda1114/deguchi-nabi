import { lookup } from "node:dns/promises";

/**
 * 画像URLを検証つきで取得し、Gemini Vision の inline_data 形式(base64)へ
 * 変換するクライアント。
 *
 * Serperの画像検索(serper-image-search-client.ts)は外部から任意のURLを
 * 返しうるため、取得前後で以下を検証する(/ai-review指摘、Codexのセカンド
 * オピニオンを踏まえて強化):
 * - http/https以外のスキームは拒否(file://等へのSSRF対策)
 * - ホスト名をDNS解決し、loopback/link-local(クラウドメタデータ169.254.169.254
 *   含む)/プライベートIP(v4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16、
 *   v6: ::1, fc00::/7, fe80::/10)へ解決される場合はfetchしない(SSRF対策、
 *   High指摘)。複数アドレスに解決される場合は1件でも該当すれば拒否する
 *   安全側の判定。DNS解決自体の失敗も安全側に倒してfetchしない
 * - Content-Typeが対応画像形式であることを事前確認し、かつ取得したbodyの
 *   マジックバイトが宣言された形式と一致することを検証する(Medium指摘:
 *   宣言だけでは任意コンテンツをimage/pngと偽装して渡せてしまうため)
 * - bodyはストリームとして読み、累計サイズが上限を超えた時点で読み取りを
 *   打ち切る(High指摘: Content-Lengthの事前チェックだけでは、ヘッダーが
 *   無い/偽装されている場合にres.arrayBuffer()で全body読み込み後にしか
 *   上限判定できず、その間にメモリを圧迫しうる)
 * - リダイレクトを追跡しない(redirect: manual、意図しないリダイレクト先への
 *   追従を防ぐ。JR東日本のような大手サイトはAkamai等のbot対策で直接fetch
 *   できないことが多く、その場合はリダイレクトではなく素直に403/エラーで
 *   失敗するため、この制約が画像取得率を大きく下げるものではないと判断)
 *
 * ネットワーク障害・検証失敗は全てnullを返す(例外を投げない、既存の
 * serper-client.ts/jina-reader-client.tsと同じ設計方針)。
 */

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Gemini Visionのinline_dataがサポートする画像MIMEタイプ。公式サポートは
 * png/jpeg/webpのみ(Gemini API公式ドキュメント。heic/heifも公式リストに
 * あるが、マジックバイト検証がISOBMFFコンテナで複雑になるため今回のスコープ
 * では対象外とする=/ai-review指摘)。gifは公式リストに無いが実測で正常に
 * 処理できることを確認済み(大宮駅PoC)。svg等の非対応形式を許してしまうと、
 * Geminiが画像を認識できず検索結果のみで応答してしまい「画像を渡したのに
 * 読めていない」ことに気づけない(実測: 梅田駅で候補1位のSVGが採用され評価
 * スコアが0まで落ちる回帰を引き起こした)。
 */
const MAGIC_BYTE_CHECKERS: [string, (bytes: Uint8Array) => boolean][] = [
  [
    "image/png",
    (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a,
  ],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  [
    "image/webp",
    (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  ],
];

const SUPPORTED_IMAGE_MIME_TYPES = new Set(MAGIC_BYTE_CHECKERS.map(([mime]) => mime));

export interface FetchedImage {
  data: string;
  mimeType: string;
}

function isFetchableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** IPv4アドレスがloopback/link-local(クラウドメタデータ含む)/プライベート範囲かどうか判定する。 */
function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // 不正な形式は安全側に倒す
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local(169.254.169.254 クラウドメタデータ含む)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

/** IPv6アドレスがloopback/link-local/unique-localかどうか判定する。 */
function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9")) {
    return true; // fe80::/10 link-local(緩めの前方一致で確実側に倒す)
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 unique-local
  const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateOrReservedIPv4(v4Mapped[1]);
  return false;
}

function isPrivateOrReservedIp(address: string, family: number): boolean {
  return family === 6 ? isPrivateOrReservedIPv6(address) : isPrivateOrReservedIPv4(address);
}

/**
 * ホスト名をDNS解決し、全ての解決先がパブリックIPであることを確認する。
 * 解決失敗・1件でもプライベート/予約範囲が含まれる場合は安全側に倒しfalseを返す。
 */
async function isSafeHostname(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((addr) => !isPrivateOrReservedIp(addr.address, addr.family));
  } catch {
    return false;
  }
}

/** 宣言されたContent-Typeとマジックバイトから検出した実体の画像形式が一致するか確認する。 */
function detectMimeTypeFromMagicBytes(bytes: Uint8Array): string | null {
  for (const [mime, check] of MAGIC_BYTE_CHECKERS) {
    if (check(bytes)) return mime;
  }
  return null;
}

/**
 * レスポンスbodyをストリームとして読み、累計サイズが上限を超えた時点で
 * 読み取りを打ち切る。Content-Lengthが無い/偽装されている場合でも、
 * 実際に読んだバイト数で上限を強制できる(/ai-review指摘、High)。
 */
async function readBodyWithLimit(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function fetchImageAsInlineData(url: string): Promise<FetchedImage | null> {
  if (!isFetchableUrl(url)) return null;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!(await isSafeHostname(hostname))) return null;

  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type");
    if (!contentType) return null;
    const declaredMimeType = contentType.split(";")[0]?.trim() ?? contentType;
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(declaredMimeType)) return null;

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) return null;

    const bytes = await readBodyWithLimit(res, MAX_IMAGE_BYTES);
    if (!bytes) return null;

    const actualMimeType = detectMimeTypeFromMagicBytes(bytes);
    if (actualMimeType !== declaredMimeType) return null;

    return {
      data: Buffer.from(bytes).toString("base64"),
      mimeType: declaredMimeType,
    };
  } catch {
    return null;
  }
}
