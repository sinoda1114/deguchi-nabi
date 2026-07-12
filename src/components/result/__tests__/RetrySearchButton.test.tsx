// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("RetrySearchButton", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  test("「もう一度検索」ボタンを描画する", async () => {
    const { RetrySearchButton } = await import("@/components/result/RetrySearchButton");
    const html = renderToStaticMarkup(<RetrySearchButton />);

    expect(html).toContain("もう一度検索");
  });

  test("リンクではなくbutton要素として描画する(現在のURLへの再アクセスのため)", async () => {
    const { RetrySearchButton } = await import("@/components/result/RetrySearchButton");
    const html = renderToStaticMarkup(<RetrySearchButton />);

    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).not.toContain("<a ");
  });

  describe("クリック時の挙動", () => {
    let container: HTMLDivElement;
    let root: Root;

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
    });

    test("クリックするとrouter.refresh()を呼び出す(同じURLへの再アクセスで再検索する)", async () => {
      const { RetrySearchButton } = await import("@/components/result/RetrySearchButton");
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root.render(<RetrySearchButton />);
      });

      const button = container.querySelector("button");
      expect(button).not.toBeNull();

      act(() => {
        button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });
});
