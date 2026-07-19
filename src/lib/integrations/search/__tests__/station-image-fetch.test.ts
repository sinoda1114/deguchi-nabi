import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const dnsLookup = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => dnsLookup(...args),
}));

const { fetchImageAsInlineData } = await import("../station-image-fetch");

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
const GIF_MAGIC = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]);
const WEBP_MAGIC = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const NOT_AN_IMAGE = new TextEncoder().encode("<!DOCTYPE html><html></html>");

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fakeImageResponse(opts: {
  ok?: boolean;
  contentType?: string;
  contentLength?: string;
  bodyBytes?: Uint8Array;
}): Response {
  const headers = new Headers();
  if (opts.contentType !== undefined) headers.set("content-type", opts.contentType);
  if (opts.contentLength !== undefined) headers.set("content-length", opts.contentLength);
  return {
    ok: opts.ok ?? true,
    headers,
    body: streamOf(opts.bodyBytes ?? PNG_MAGIC),
  } as unknown as Response;
}

describe("fetchImageAsInlineData", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    dnsLookup.mockReset();
    // デフォルトはパブリックIP(安全)を返す。SSRF系テストのみ個別に上書きする。
    dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("image/pngを正常に取得しbase64へ変換する(マジックバイトも一致)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeImageResponse({
        contentType: "image/png",
        contentLength: String(PNG_MAGIC.byteLength),
        bodyBytes: PNG_MAGIC,
      })
    );

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/png");
    expect(result?.data).toBe(Buffer.from(PNG_MAGIC).toString("base64"));
  });

  test("image/jpeg・image/webp・image/gifもマジックバイトが一致すれば取得できる", async () => {
    const cases: [string, Uint8Array][] = [
      ["image/jpeg", JPEG_MAGIC],
      ["image/webp", WEBP_MAGIC],
      ["image/gif", GIF_MAGIC],
    ];
    for (const [contentType, bytes] of cases) {
      vi.mocked(fetch).mockResolvedValue(
        fakeImageResponse({ contentType, contentLength: String(bytes.byteLength), bodyBytes: bytes })
      );
      const result = await fetchImageAsInlineData("https://example.com/a");
      expect(result?.mimeType).toBe(contentType);
    }
  });

  test("宣言されたContent-Typeとマジックバイトの実体が一致しない場合はnullを返す(HTMLエラーページがimage/pngを詐称するケース対策)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeImageResponse({
        contentType: "image/png",
        contentLength: String(NOT_AN_IMAGE.byteLength),
        bodyBytes: NOT_AN_IMAGE,
      })
    );

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("HTTPエラー(非200)はnullを返す", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeImageResponse({ ok: false, contentType: "image/png" }));

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("SVGはGemini Vision非対応のためnullを返す(実測: 梅田駅で候補1位のSVGが採用され全滅した回帰)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeImageResponse({ contentType: "image/svg+xml", contentLength: "100" })
    );

    const result = await fetchImageAsInlineData("https://example.com/a.svg");

    expect(result).toBeNull();
  });

  test("Content-Typeがimage/*でない場合はnullを返す(誤った画像URL・HTMLエラーページ対策)", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeImageResponse({ contentType: "text/html" }));

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("Content-Typeが無い場合もnullを返す", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeImageResponse({}));

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("Content-Lengthがサイズ上限を超える場合はnullを返す(巨大画像対策、事前拒否)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeImageResponse({ contentType: "image/png", contentLength: String(20 * 1024 * 1024) })
    );

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("Content-Length偽装・欠落時もストリーム読み取り中に上限超過を検知してnullを返す(/ai-review指摘、High: 旧実装はarrayBuffer()で全読み込み後にしか判定できなかった)", async () => {
    const chunkSize = 4 * 1024 * 1024; // 4MB
    let pulled = 0;
    // 上限(10MB)を大きく超える量(11チャンク=44MB)を用意しておき、実際には
    // 上限超過を検知した時点で打ち切られ、全チャンクは読み切られないことを検証する。
    // ReadableStreamは仕様上1チャンク程度の先読みが起こりうるため、厳密な
    // 回数の一致ではなく「用意した全量は読み切らない」ことを確認する。
    const totalChunksAvailable = 11;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= totalChunksAvailable) {
          controller.close();
          return;
        }
        pulled++;
        controller.enqueue(new Uint8Array(chunkSize));
      },
    });
    const headers = new Headers({ "content-type": "image/png" }); // content-length宣言なし(偽装/欠落を模す)
    vi.mocked(fetch).mockResolvedValue({ ok: true, headers, body: stream } as unknown as Response);

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
    // 上限(10MB=約3チャンク分)超過時点で打ち切るため、用意した11チャンク
    // 全量(44MB)を読み切ってはいけない
    expect(pulled).toBeLessThan(totalChunksAvailable);
  });

  test("fetchが例外を投げた場合(タイムアウト含む)はnullを返す", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("http/https以外のURLはfetchせずnullを返す(SSRF対策)", async () => {
    const result = await fetchImageAsInlineData("file:///etc/passwd");

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("不正なURL文字列はfetchせずnullを返す", async () => {
    const result = await fetchImageAsInlineData("not-a-url");

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("リダイレクトを追跡しない設定でfetchする(redirect: manual)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeImageResponse({ contentType: "image/jpeg", contentLength: String(JPEG_MAGIC.byteLength), bodyBytes: JPEG_MAGIC })
    );

    await fetchImageAsInlineData("https://example.com/a.jpg");

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/a.jpg",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  test("名前解決先がloopback(127.0.0.1)の場合はfetchせずnullを返す(SSRF対策)", async () => {
    dnsLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const result = await fetchImageAsInlineData("https://internal.example.com/a.png");

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("名前解決先がクラウドメタデータエンドポイント(169.254.169.254)の場合はfetchせずnullを返す(SSRF対策)", async () => {
    dnsLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    const result = await fetchImageAsInlineData("https://metadata.example.com/a.png");

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("名前解決先がプライベートIP(10.x/172.16-31.x/192.168.x)の場合はfetchせずnullを返す(SSRF対策)", async () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "192.168.1.1"]) {
      dnsLookup.mockResolvedValue([{ address: ip, family: 4 }]);
      const result = await fetchImageAsInlineData("https://internal.example.com/a.png");
      expect(result).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test("名前解決先がIPv6のloopback(::1)・unique-local(fc00::/7)の場合はfetchせずnullを返す(SSRF対策)", async () => {
    for (const ip of ["::1", "fc00::1", "fd12:3456:789a::1", "fe80::1"]) {
      dnsLookup.mockResolvedValue([{ address: ip, family: 6 }]);
      const result = await fetchImageAsInlineData("https://internal.example.com/a.png");
      expect(result).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test("複数の解決先のうち1件でもプライベートIPが含まれればfetchしない(DNS rebinding的なケースへの安全側判定)", async () => {
    dnsLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);

    const result = await fetchImageAsInlineData("https://mixed.example.com/a.png");

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("DNS解決自体が失敗した場合は安全側に倒してfetchしない", async () => {
    dnsLookup.mockRejectedValue(new Error("DNS resolution failed"));

    const result = await fetchImageAsInlineData("https://nonexistent.example.com/a.png");

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("パブリックIPへ解決される場合は通常どおり取得する", async () => {
    dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.mocked(fetch).mockResolvedValue(
      fakeImageResponse({ contentType: "image/png", contentLength: String(PNG_MAGIC.byteLength), bodyBytes: PNG_MAGIC })
    );

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).not.toBeNull();
  });
});
