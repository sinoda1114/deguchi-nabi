import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

/**
 * 画像URLを検証つきで取得し、Gemini Vision の inline_data 形式(base64)へ
 * 変換するクライアント。
 *
 * Serperの画像検索(serper-image-search-client.ts)は外部から任意のURLを
 * 返しうるため、取得前後で以下を検証する(/ai-review指摘、Codexのセカンド
 * オピニオンを踏まえて強化):
 * - http/https以外のスキームは拒否(file://等へのSSRF対策)
 * - ホスト名解決をundiciのAgentの`connect.lookup`フックで検証する
 *   (loopback/link-local(クラウドメタデータ169.254.169.254含む)/
 *   プライベートIP(v4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16、
 *   v6: ::1, fc00::/7, fe80::/10)を拒否)。
 *
 *   重要: 事前に別途DNS解決してチェックしてから通常のfetchを呼ぶ実装では、
 *   検証時の名前解決と実際の接続時の名前解決が別々のタイミングで行われ、
 *   攻撃者が権威DNSを制御し極端に短いTTLを設定すれば、検証時はパブリック
 *   IPを、接続時はプライベートIP(DNS rebinding)を返すことでSSRF対策を
 *   バイパスできてしまう(TOCTOU、/security-review指摘、High)。この
 *   Agentの`connect.lookup`フックは実際のTCP接続に使われる名前解決その
 *   ものをフックするため、検証と接続が同一の解決結果を使うことが保証され
 *   TOCTOUが構造的に発生しない
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

/**
 * loopback/link-local(クラウドメタデータ169.254.169.254含む)/プライベート
 * IP範囲のブロックリスト。手動の文字列プレフィックス比較(旧実装)は、
 * IPv4-mapped IPv6アドレスがhex表記(`::ffff:7f00:1`)で来た場合に
 * ドット十進表記(`::ffff:127.0.0.1`)しか見ていない正規表現をすり抜けて
 * しまうバグがあった(/security-review再指摘、High。WHATWG URLパーサーは
 * IPv6リテラルをhex表記に正規化するため、URL経由の攻撃はほぼ確実にこの
 * バグを突ける)。Node標準の`net.BlockList`はアドレスをバイト単位で解釈し、
 * IPv4-mapped IPv6の正規化も内部で行うため、表記ゆれによるバイパスが
 * 構造的に発生しない。
 */
const PRIVATE_BLOCK_LIST = new BlockList();
PRIVATE_BLOCK_LIST.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE_BLOCK_LIST.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_BLOCK_LIST.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_BLOCK_LIST.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_BLOCK_LIST.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_BLOCK_LIST.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_BLOCK_LIST.addAddress("::1", "ipv6");
PRIVATE_BLOCK_LIST.addAddress("::", "ipv6");
PRIVATE_BLOCK_LIST.addSubnet("fc00::", 7, "ipv6"); // unique-local
PRIVATE_BLOCK_LIST.addSubnet("fe80::", 10, "ipv6"); // link-local

function isPrivateOrReservedIp(address: string, family: number): boolean {
  try {
    return PRIVATE_BLOCK_LIST.check(address, family === 6 ? "ipv6" : "ipv4");
  } catch {
    return true; // 不正な形式は安全側に倒す
  }
}

/**
 * URLのホスト名がIPリテラル(例: `http://127.0.0.1/`, `http://[::1]/`)で、
 * かつプライベート/予約範囲であればtrueを返す(/security-review再指摘、
 * High)。IPリテラルのURLはTCP接続時に名前解決自体が発生しないため、
 * undiciのAgentの`connect.lookup`フックが呼ばれない(=SSRF対策が素通り
 * する)経路になりうる。ホスト名が既にIPアドレスの場合はDNS解決を待たず
 * ここで直接判定する。
 */
function isBlockedIpLiteralUrl(url: string): boolean {
  // URL.hostnameはIPv6リテラルを"[::1]"のようにブラケット付きで返すため、
  // net.isIP()に渡す前に取り除く(ブラケット付きのままだとIPと認識されない)。
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  if (family === 0) return false; // IPリテラルではない(通常のホスト名)
  return isPrivateOrReservedIp(hostname, family);
}

type NodeLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number
) => void;

/**
 * undiciのAgentの`connect.lookup`へ渡すカスタム名前解決関数を作る。
 * 実際のTCP接続に使われる名前解決そのものをフックするため、検証と接続が
 * 別タイミングの解決結果を使うことによるTOCTOU(DNS rebinding)を構造的に
 * 防げる(/security-review指摘、High)。全解決先を確認し、1件でもプライベート
 * /予約範囲が含まれれば接続自体をエラーにする安全側の判定。
 */
export function createSsrfSafeLookup() {
  return (hostname: string, _options: unknown, callback: NodeLookupCallback): void => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        callback(err, "", 4);
        return;
      }
      if (!addresses || addresses.length === 0) {
        callback(new Error(`SSRF guard: ${hostname} が名前解決できませんでした`), "", 4);
        return;
      }
      const unsafe = addresses.find((addr) => isPrivateOrReservedIp(addr.address, addr.family));
      if (unsafe) {
        callback(
          new Error(`SSRF guard: ${hostname} はプライベート/予約IPへ解決されたためブロックしました`),
          "",
          4
        );
        return;
      }
      const chosen = addresses[0];
      callback(null, chosen.address, chosen.family);
    });
  };
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
async function readBodyWithLimit(
  res: Awaited<ReturnType<typeof undiciFetch>>,
  maxBytes: number
): Promise<Uint8Array | null> {
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

/**
 * 未消費のレスポンスbodyを破棄する。呼ばずに関数を抜けると、相手サーバーが
 * ヘッダー送信後にbodyを終端しない場合、直後のAgent.close()が未完了の
 * コネクションの終了を待って滞留しうる(/security-review再指摘、Medium)。
 */
async function cancelBody(res: Awaited<ReturnType<typeof undiciFetch>>): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

export async function fetchImageAsInlineData(url: string): Promise<FetchedImage | null> {
  if (!isFetchableUrl(url)) return null;
  if (isBlockedIpLiteralUrl(url)) return null;

  // SSRF対策: undiciのAgentごとにconnect.lookupフックを設定し、実際のTCP接続に
  // 使われる名前解決そのものでプライベートIPを拒否する(TOCTOU対策、上記コメント参照)。
  const agent = new Agent({ connect: { lookup: createSsrfSafeLookup() } });

  try {
    const res = await undiciFetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      dispatcher: agent as unknown as Dispatcher,
    });

    if (!res.ok) {
      await cancelBody(res);
      return null;
    }

    const contentType = res.headers.get("content-type");
    if (!contentType) {
      await cancelBody(res);
      return null;
    }
    const declaredMimeType = contentType.split(";")[0]?.trim() ?? contentType;
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(declaredMimeType)) {
      await cancelBody(res);
      return null;
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
      await cancelBody(res);
      return null;
    }

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
  } finally {
    await agent.close().catch(() => {});
  }
}
