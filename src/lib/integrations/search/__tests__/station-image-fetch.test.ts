import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const dnsLookup = vi.fn();
vi.mock("node:dns", () => ({
  lookup: (...args: unknown[]) => dnsLookup(...args),
}));

const undiciFetchMock = vi.fn();
const agentCloseMock = vi.fn().mockResolvedValue(undefined);
let lastAgentOptions: unknown;

class MockAgent {
  options: unknown;
  close = agentCloseMock;
  constructor(options: unknown) {
    this.options = options;
    lastAgentOptions = options;
  }
}

vi.mock("undici", () => ({
  fetch: (...args: unknown[]) => undiciFetchMock(...args),
  Agent: MockAgent,
}));

const { fetchImageAsInlineData, createSsrfSafeLookup } = await import("../station-image-fetch");

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
}) {
  const headers = new Headers();
  if (opts.contentType !== undefined) headers.set("content-type", opts.contentType);
  if (opts.contentLength !== undefined) headers.set("content-length", opts.contentLength);
  return {
    ok: opts.ok ?? true,
    headers,
    body: streamOf(opts.bodyBytes ?? PNG_MAGIC),
  };
}

describe("fetchImageAsInlineData", () => {
  beforeEach(() => {
    undiciFetchMock.mockReset();
    agentCloseMock.mockReset().mockResolvedValue(undefined);
    dnsLookup.mockReset();
    lastAgentOptions = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("image/pngを正常に取得しbase64へ変換する(マジックバイトも一致)", async () => {
    undiciFetchMock.mockResolvedValue(
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
      undiciFetchMock.mockResolvedValue(
        fakeImageResponse({ contentType, contentLength: String(bytes.byteLength), bodyBytes: bytes })
      );
      const result = await fetchImageAsInlineData("https://example.com/a");
      expect(result?.mimeType).toBe(contentType);
    }
  });

  test("宣言されたContent-Typeとマジックバイトの実体が一致しない場合はnullを返す(HTMLエラーページがimage/pngを詐称するケース対策)", async () => {
    undiciFetchMock.mockResolvedValue(
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
    undiciFetchMock.mockResolvedValue(fakeImageResponse({ ok: false, contentType: "image/png" }));

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("早期return時(HTTPエラー・非対応Content-Type等)はbodyをキャンセルしてから終了する(/security-review再指摘、Medium: 未消費のbodyがAgent.close()を滞留させるリスク)", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const bodyWithCancel = { ...streamOf(PNG_MAGIC), cancel };
    undiciFetchMock.mockResolvedValue({
      ok: false,
      headers: new Headers({ "content-type": "image/png" }),
      body: bodyWithCancel,
    });

    await fetchImageAsInlineData("https://example.com/a.png");

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("SVGはGemini Vision非対応のためnullを返す(実測: 梅田駅で候補1位のSVGが採用され全滅した回帰)", async () => {
    undiciFetchMock.mockResolvedValue(
      fakeImageResponse({ contentType: "image/svg+xml", contentLength: "100" })
    );

    const result = await fetchImageAsInlineData("https://example.com/a.svg");

    expect(result).toBeNull();
  });

  test("Content-Typeがimage/*でない場合はnullを返す(誤った画像URL・HTMLエラーページ対策)", async () => {
    undiciFetchMock.mockResolvedValue(fakeImageResponse({ contentType: "text/html" }));

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("Content-Typeが無い場合もnullを返す", async () => {
    undiciFetchMock.mockResolvedValue(fakeImageResponse({}));

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("Content-Lengthがサイズ上限を超える場合はnullを返す(巨大画像対策、事前拒否)", async () => {
    undiciFetchMock.mockResolvedValue(
      fakeImageResponse({ contentType: "image/png", contentLength: String(20 * 1024 * 1024) })
    );

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("Content-Length偽装・欠落時もストリーム読み取り中に上限超過を検知してnullを返す(/ai-review指摘、High: 旧実装はarrayBuffer()で全読み込み後にしか判定できなかった)", async () => {
    const chunkSize = 4 * 1024 * 1024; // 4MB
    let pulled = 0;
    const totalChunksAvailable = 11; // 上限(10MB)を大きく超える量を用意
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
    undiciFetchMock.mockResolvedValue({ ok: true, headers, body: stream });

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
    expect(pulled).toBeLessThan(totalChunksAvailable);
  });

  test("fetchが例外を投げた場合(タイムアウト含む)はnullを返す", async () => {
    undiciFetchMock.mockRejectedValue(new Error("network error"));

    const result = await fetchImageAsInlineData("https://example.com/a.png");

    expect(result).toBeNull();
  });

  test("http/https以外のURLはfetchせずnullを返す(SSRF対策)", async () => {
    const result = await fetchImageAsInlineData("file:///etc/passwd");

    expect(result).toBeNull();
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  test("不正なURL文字列はfetchせずnullを返す", async () => {
    const result = await fetchImageAsInlineData("not-a-url");

    expect(result).toBeNull();
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  test("ホスト名がIPv4リテラルでプライベート/予約範囲の場合はfetchせずnullを返す(/security-review再指摘、High: IPリテラルURLはTCP接続時に名前解決自体が発生せずconnect.lookupフックがバイパスされうる)", async () => {
    for (const ip of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "192.168.1.1"]) {
      const result = await fetchImageAsInlineData(`http://${ip}/a.png`);
      expect(result).toBeNull();
    }
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  test("ホスト名がIPv6リテラルでプライベート/予約範囲の場合はfetchせずnullを返す", async () => {
    const result = await fetchImageAsInlineData("http://[::1]/a.png");

    expect(result).toBeNull();
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  test("ホスト名がパブリックIPリテラルの場合は許可してfetchする", async () => {
    undiciFetchMock.mockResolvedValue(
      fakeImageResponse({
        contentType: "image/png",
        contentLength: String(PNG_MAGIC.byteLength),
        bodyBytes: PNG_MAGIC,
      })
    );

    const result = await fetchImageAsInlineData("http://93.184.216.34/a.png");

    expect(result).not.toBeNull();
    expect(undiciFetchMock).toHaveBeenCalled();
  });

  test("リダイレクトを追跡しない設定でfetchする(redirect: manual)", async () => {
    undiciFetchMock.mockResolvedValue(
      fakeImageResponse({
        contentType: "image/jpeg",
        contentLength: String(JPEG_MAGIC.byteLength),
        bodyBytes: JPEG_MAGIC,
      })
    );

    await fetchImageAsInlineData("https://example.com/a.jpg");

    expect(undiciFetchMock).toHaveBeenCalledWith(
      "https://example.com/a.jpg",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  test("undiciのAgentにconnect.lookupフックを渡してfetchする(SSRF対策のTOCTOU回避)", async () => {
    undiciFetchMock.mockResolvedValue(
      fakeImageResponse({
        contentType: "image/png",
        contentLength: String(PNG_MAGIC.byteLength),
        bodyBytes: PNG_MAGIC,
      })
    );

    await fetchImageAsInlineData("https://example.com/a.png");

    expect(undiciFetchMock).toHaveBeenCalledWith(
      "https://example.com/a.png",
      expect.objectContaining({ dispatcher: expect.any(MockAgent) })
    );
    expect(lastAgentOptions).toEqual({
      connect: { lookup: expect.any(Function) },
    });
  });

  test("成功時・失敗時どちらでもAgentをcloseする(リソースリーク防止)", async () => {
    undiciFetchMock.mockResolvedValue(
      fakeImageResponse({
        contentType: "image/png",
        contentLength: String(PNG_MAGIC.byteLength),
        bodyBytes: PNG_MAGIC,
      })
    );
    await fetchImageAsInlineData("https://example.com/a.png");
    expect(agentCloseMock).toHaveBeenCalledTimes(1);

    agentCloseMock.mockClear();
    undiciFetchMock.mockRejectedValue(new Error("boom"));
    await fetchImageAsInlineData("https://example.com/b.png");
    expect(agentCloseMock).toHaveBeenCalledTimes(1);
  });
});

describe("createSsrfSafeLookup", () => {
  beforeEach(() => {
    dnsLookup.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function runLookup(hostname: string): Promise<[Error | null, string, number]> {
    return new Promise((resolve) => {
      createSsrfSafeLookup()(hostname, {}, (err, address, family) => {
        resolve([err, address, family]);
      });
    });
  }

  test("パブリックIPへ解決される場合はそのアドレスをcallbackへ渡す", async () => {
    dnsLookup.mockImplementation((_hostname, _opts, cb) => {
      cb(null, [{ address: "93.184.216.34", family: 4 }]);
    });

    const [err, address, family] = await runLookup("example.com");

    expect(err).toBeNull();
    expect(address).toBe("93.184.216.34");
    expect(family).toBe(4);
  });

  test("loopback(127.0.0.1)へ解決される場合はエラーをcallbackへ渡す(SSRF対策)", async () => {
    dnsLookup.mockImplementation((_hostname, _opts, cb) => {
      cb(null, [{ address: "127.0.0.1", family: 4 }]);
    });

    const [err] = await runLookup("internal.example.com");

    expect(err).not.toBeNull();
  });

  test("クラウドメタデータエンドポイント(169.254.169.254)へ解決される場合はエラーをcallbackへ渡す(SSRF対策)", async () => {
    dnsLookup.mockImplementation((_hostname, _opts, cb) => {
      cb(null, [{ address: "169.254.169.254", family: 4 }]);
    });

    const [err] = await runLookup("metadata.example.com");

    expect(err).not.toBeNull();
  });

  test("プライベートIP(10.x/172.16-31.x/192.168.x)へ解決される場合はエラーをcallbackへ渡す(SSRF対策)", async () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "192.168.1.1"]) {
      dnsLookup.mockImplementation((_hostname, _opts, cb) => {
        cb(null, [{ address: ip, family: 4 }]);
      });
      const [err] = await runLookup("internal.example.com");
      expect(err).not.toBeNull();
    }
  });

  test("IPv6のloopback(::1)・unique-local(fc00::/7)・link-local(fe80::/10)はエラーをcallbackへ渡す(SSRF対策)", async () => {
    for (const ip of ["::1", "fc00::1", "fd12:3456:789a::1", "fe80::1"]) {
      dnsLookup.mockImplementation((_hostname, _opts, cb) => {
        cb(null, [{ address: ip, family: 6 }]);
      });
      const [err] = await runLookup("internal.example.com");
      expect(err).not.toBeNull();
    }
  });

  test("複数の解決先のうち1件でもプライベートIPが含まれればエラーをcallbackへ渡す(安全側の判定)", async () => {
    dnsLookup.mockImplementation((_hostname, _opts, cb) => {
      cb(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]);
    });

    const [err] = await runLookup("mixed.example.com");

    expect(err).not.toBeNull();
  });

  test("DNS解決自体が失敗した場合はエラーをそのままcallbackへ渡す", async () => {
    const dnsError = new Error("DNS resolution failed");
    dnsLookup.mockImplementation((_hostname, _opts, cb) => {
      cb(dnsError);
    });

    const [err] = await runLookup("nonexistent.example.com");

    expect(err).toBe(dnsError);
  });

  test("解決先が0件の場合はエラーをcallbackへ渡す", async () => {
    dnsLookup.mockImplementation((_hostname, _opts, cb) => {
      cb(null, []);
    });

    const [err] = await runLookup("empty.example.com");

    expect(err).not.toBeNull();
  });
});
