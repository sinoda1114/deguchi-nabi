import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@/lib/domain/user";

const getSessionUserMock = vi.fn<() => Promise<User | null>>();
const checkRoutesSearchRateLimitMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.1" })),
}));

vi.mock("@/lib/rate-limit/ip-rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit/ip-rate-limit")>(
    "@/lib/rate-limit/ip-rate-limit"
  );
  return {
    ...actual,
    checkRoutesSearchRateLimit: (ip: string) => checkRoutesSearchRateLimitMock(ip),
  };
});

/**
 * page.tsx自体の責務(URLパラメータの必須チェック・レートリミット判定)のみを
 * 検証する。origin/destinationの解決・経路候補の解決・履歴保存等はSuspense配下の
 * RouteResultBodyに委譲されたため、それらのケースは
 * components/result/__tests__/RouteResultBody.test.tsx で検証する。
 */
describe("RouteResultPage", () => {
  beforeEach(() => {
    getSessionUserMock.mockReset();
    getSessionUserMock.mockResolvedValue(null);
    checkRoutesSearchRateLimitMock.mockReset();
    checkRoutesSearchRateLimitMock.mockResolvedValue({ allowed: true });
  });

  test("再試行不可能なエラー(検索条件不足)では「もう一度検索」ボタンを表示しない", async () => {
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    const element = await RouteResultPage({
      searchParams: Promise.resolve({ mode: "easy" }), // originStationId/destinationId無し
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("検索条件が不足しています");
    expect(html).toContain("検索へ戻る");
    expect(html).not.toContain("もう一度検索");
  });

  test("レートリミット超過時はAI呼び出しへ進まずエラー画面を表示する", async () => {
    checkRoutesSearchRateLimitMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const { default: RouteResultPage } = await import("@/app/routes/result/page");

    const element = await RouteResultPage({
      searchParams: Promise.resolve({
        originType: "home_station",
        destinationType: "station",
        destinationId: "st_1",
        mode: "easy",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("アクセスが集中しています");
    expect(checkRoutesSearchRateLimitMock).toHaveBeenCalledWith("203.0.113.1");
  });
});
