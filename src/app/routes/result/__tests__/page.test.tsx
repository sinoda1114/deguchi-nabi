import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@/lib/domain/user";

const getSessionUserMock = vi.fn<() => Promise<User | null>>();

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * page.tsx自体の責務(URLパラメータの必須チェック)のみを検証する。
 * origin/destinationの解決・経路候補の解決・履歴保存等はSuspense配下の
 * RouteResultBodyに委譲されたため、それらのケースは
 * components/result/__tests__/RouteResultBody.test.tsx で検証する。
 */
describe("RouteResultPage", () => {
  beforeEach(() => {
    getSessionUserMock.mockReset();
    getSessionUserMock.mockResolvedValue(null);
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
});
