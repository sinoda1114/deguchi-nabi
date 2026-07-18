/**
 * 検索結果1件(SearchSourceCandidate)をスコアリングする純粋関数モジュール。
 * Gemini の Google Search Grounding 等から取得した検索結果を、そのまま鵜呑みに
 * せず「公式ドメインか」「関連語を含むか」「一次資料(PDF)か」「新しいか」
 * 「まとめサイト・個人ブログらしきドメインか」で機械的に採点する。
 * このモジュール単体では呼び出し元(route-provider/station-provider)への配線は
 * 行わない。confidence(確信度)の最終判定は source-confidence.ts が担う。
 */

export interface SearchSourceCandidate {
  url: string;
  title: string;
  /** ISO8601形式の発行日時。取得できない場合は null。 */
  publishedAt: string | null;
}

export interface ScoredSearchSource {
  candidate: SearchSourceCandidate;
  score: number;
  /** スコアリング根拠(日本語の説明文)。UI/ログでそのまま表示できる粒度にする。 */
  reasons: string[];
  /** 公式ドメイン判定結果。source-confidence.ts が複数ソース照合に使う。 */
  isOfficialDomain: boolean;
}

/**
 * 鉄道事業者・国交省等の公式ドメインパターン。将来的に私鉄・地下鉄事業者を
 * 追加していく前提で、個別ドメインの配列として分離してexportする
 * (現時点ではCouncil議論で挙がった代表例のみ)。
 * `.go.jp` / `.lg.jp` は日本の政府・地方公共団体専用ドメインであり、
 * 第三者が取得できないため包括的に公式として扱ってよい。
 */
export const OFFICIAL_DOMAIN_PATTERNS: RegExp[] = [
  /(^|\.)jreast\.co\.jp$/i,
  /(^|\.)tokyometro\.jp$/i,
  /(^|\.)jrtc\.co\.jp$/i,
  // 主要私鉄・地下鉄・JR各社の公式ドメイン(PR5で追加。Serper検索パイプラインが
  // 全国の駅を対象にするため、公式一次資料を確実に高スコア化できるよう拡張)。
  /(^|\.)tokyu\.co\.jp$/i,
  /(^|\.)odakyu\.jp$/i,
  /(^|\.)keio\.co\.jp$/i,
  /(^|\.)seiburailway\.jp$/i,
  /(^|\.)tobu\.co\.jp$/i,
  /(^|\.)keisei\.co\.jp$/i,
  /(^|\.)keikyu\.co\.jp$/i,
  /(^|\.)sotetsu\.co\.jp$/i,
  /(^|\.)jr-central\.co\.jp$/i,
  /(^|\.)westjr\.co\.jp$/i,
  /(^|\.)jr-odekake\.net$/i,
  /(^|\.)jrkyushu\.co\.jp$/i,
  /(^|\.)jrhokkaido\.co\.jp$/i,
  /(^|\.)osakametro\.co\.jp$/i,
  /(^|\.)hankyu\.co\.jp$/i,
  /(^|\.)hanshin\.co\.jp$/i,
  /(^|\.)kintetsu\.co\.jp$/i,
  /(^|\.)nankai\.co\.jp$/i,
  /(^|\.)nishitetsu\.jp$/i,
  /(^|\.)nagoya-kotsu\.jp$/i,
  /(^|\.)go\.jp$/i,
  /(^|\.)lg\.jp$/i,
];

/**
 * まとめサイト・個人ブログらしきドメインパターン(簡易判定)。
 * 完全な検出は目指さず、既知の代表的なブログ/CGMサービスのみを対象にする。
 */
export const LOW_QUALITY_DOMAIN_PATTERNS: RegExp[] = [
  /(^|\.)hatenablog\.(com|jp)$/i,
  /(^|\.)ameblo\.jp$/i,
  /(^|\.)note\.com$/i,
  /(^|\.)blog\.livedoor\.jp$/i,
  /(^|\.)fc2\.com$/i,
  /(^|\.)blogspot\.com$/i,
];

/** タイトルに含まれると「駅の出口・構内案内に関連している」とみなす語。 */
const RELEVANT_TITLE_KEYWORDS = [
  "構内図",
  "出口案内",
  "出口",
  "改札",
  "案内図",
  "乗り換え",
  "乗換",
  "アクセス",
];

const OFFICIAL_DOMAIN_SCORE = 3;
const RELEVANT_TITLE_KEYWORD_SCORE = 2;
const PDF_SCORE = 1;
const RECENT_SCORE = 1;
const LOW_QUALITY_DOMAIN_PENALTY = -2;

/** 発行日がこの年数以内なら「新しい」とみなす。 */
const RECENT_THRESHOLD_YEARS = 2;

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * URLからホスト名を取り出す。パース失敗時は空文字。
 * source-confidence.ts が「独立したドメインの件数」を数える際に使う
 * (同一ドメインの重複ページを別々の独立ソースとして数えないため)。
 */
export function extractHostname(url: string): string {
  return safeParseUrl(url)?.hostname ?? "";
}

/**
 * ホスト名が公式ドメインパターンに一致するか判定する。
 * URLパース失敗時は呼び出し側で false 扱いになるよう、hostname文字列のみを受け取る。
 */
export function isOfficialDomain(hostname: string): boolean {
  return OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function isLowQualityDomain(hostname: string): boolean {
  return LOW_QUALITY_DOMAIN_PATTERNS.some((pattern) => pattern.test(hostname));
}

function containsRelevantKeyword(title: string): boolean {
  return RELEVANT_TITLE_KEYWORDS.some((keyword) => title.includes(keyword));
}

function isPdfUrl(url: string): boolean {
  const parsed = safeParseUrl(url);
  const pathname = parsed?.pathname ?? url;
  return pathname.toLowerCase().endsWith(".pdf");
}

function isRecent(publishedAt: string | null, now: Date): boolean {
  if (publishedAt === null) return false;
  const publishedDate = new Date(publishedAt);
  if (Number.isNaN(publishedDate.getTime())) return false;
  const diffMs = now.getTime() - publishedDate.getTime();
  // 未来日は不正データの可能性があるため「新しい」とみなさない。
  if (diffMs < 0) return false;
  const thresholdMs = RECENT_THRESHOLD_YEARS * 365 * 24 * 60 * 60 * 1000;
  return diffMs <= thresholdMs;
}

/**
 * 検索結果1件を採点する。now は「発行日が新しいか」の基準時刻で、
 * テスト容易性のため呼び出し側から注入できるようにしている(既定は現在時刻)。
 */
export function scoreSearchSource(
  candidate: SearchSourceCandidate,
  now: Date = new Date()
): ScoredSearchSource {
  const reasons: string[] = [];
  let score = 0;

  const parsedUrl = safeParseUrl(candidate.url);
  const hostname = parsedUrl?.hostname ?? "";
  const officialDomain = hostname !== "" && isOfficialDomain(hostname);

  if (officialDomain) {
    score += OFFICIAL_DOMAIN_SCORE;
    reasons.push(`公式ドメイン (${hostname})`);
  } else if (hostname !== "" && isLowQualityDomain(hostname)) {
    score += LOW_QUALITY_DOMAIN_PENALTY;
    reasons.push(`まとめサイト・個人ブログの可能性があるドメイン (${hostname})`);
  }

  if (containsRelevantKeyword(candidate.title)) {
    score += RELEVANT_TITLE_KEYWORD_SCORE;
    reasons.push("タイトルに出口・構内案内の関連語を含む");
  }

  if (isPdfUrl(candidate.url)) {
    score += PDF_SCORE;
    reasons.push("PDF形式(一次資料の可能性が高い)");
  }

  if (isRecent(candidate.publishedAt, now)) {
    score += RECENT_SCORE;
    reasons.push(`発行から${RECENT_THRESHOLD_YEARS}年以内`);
  }

  return {
    candidate,
    score,
    reasons,
    isOfficialDomain: officialDomain,
  };
}
