// @vitest-environment jsdom
import { describe, expect, test, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FavoriteDestination, User } from "@/lib/domain/user";
import type { Station } from "@/lib/domain/station";

// React 19のact()はjsdom環境下でこのフラグを見て、非同期state更新の警告要否を判定する。
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER: User = {
  userId: "u1",
  email: "a@example.com",
  displayName: "テスト太郎",
  homeStationId: null,
  plan: "free",
  locale: "ja",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const STATION: Station = {
  stationId: "st_shibuya",
  stationName: "渋谷駅",
  operator: "東急電鉄",
  lines: ["東急東横線"],
  prefecture: "東京都",
  latitude: 35.658,
  longitude: 139.7016,
};

function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("DestinationField 候補一覧の星ボタン(その場でお気に入り登録)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = global.fetch;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("星をクリックすると候補を確定(onChange)せずに登録APIを呼び、成功後は登録済み表示になる", async () => {
    const onChange = vi.fn();
    const favorite: FavoriteDestination = {
      favoriteDestinationId: "fd1",
      userId: "u1",
      kind: "station",
      station: STATION,
      label: "渋谷駅",
      createdAt: "2026-01-02T00:00:00.000Z",
    };

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/places/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ candidates: [{ kind: "station", station: STATION }] }),
        } as Response);
      }
      if (url.includes("/api/favorite-destinations")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ favoriteDestination: favorite }),
        } as Response);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { DestinationField } = await import("../DestinationField");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <DestinationField user={USER} favoriteDestinations={[]} value={null} onChange={onChange} />
      );
    });

    const input = container.querySelector('input[aria-label="目的地"]') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event("focus", { bubbles: true }));
      typeInto(input, "渋谷");
    });

    // useDebouncedValue(250ms)分の猶予を待ってから候補取得の完了を待つ
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const starButton = container.querySelector(
      'button[aria-label="よく使う行き先に追加"]'
    ) as HTMLButtonElement;
    expect(starButton).not.toBeNull();

    // 入力変更(候補取得トリガー)による onChange(null) 呼び出し分をリセットし、
    // 星クリック時に「候補確定」が新たに発火しないことだけを検証する。
    onChange.mockClear();

    await act(async () => {
      starButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/favorite-destinations",
      expect.objectContaining({ method: "POST" })
    );
    expect(container.querySelector('button[aria-label="登録済み"]')).not.toBeNull();
  });

  test("既に登録済みの候補は星ボタンが無効化されPOSTされない", async () => {
    const onChange = vi.fn();
    const existingFavorite: FavoriteDestination = {
      favoriteDestinationId: "fd1",
      userId: "u1",
      kind: "station",
      station: STATION,
      label: "渋谷駅",
      createdAt: "2026-01-02T00:00:00.000Z",
    };

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/places/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ candidates: [{ kind: "station", station: STATION }] }),
        } as Response);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { DestinationField } = await import("../DestinationField");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <DestinationField
          user={USER}
          favoriteDestinations={[existingFavorite]}
          value={null}
          onChange={onChange}
        />
      );
    });

    const input = container.querySelector('input[aria-label="目的地"]') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event("focus", { bubbles: true }));
      typeInto(input, "渋谷");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const starButton = container.querySelector(
      'button[aria-label="登録済み"]'
    ) as HTMLButtonElement;
    expect(starButton).not.toBeNull();
    expect(starButton.disabled).toBe(true);

    await act(async () => {
      starButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/favorite-destinations",
      expect.anything()
    );
  });
});

describe("DestinationField 候補一覧の閉店・公式サイト注記", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = global.fetch;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function renderWithCandidates(candidates: unknown[]) {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/places/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ candidates }),
        } as Response);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { DestinationField } = await import("../DestinationField");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <DestinationField
          user={USER}
          favoriteDestinations={[]}
          value={null}
          onChange={vi.fn()}
        />
      );
    });

    const input = container.querySelector('input[aria-label="目的地"]') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event("focus", { bubbles: true }));
      typeInto(input, "テスト");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  test("一時休業中の施設候補には「一時休業中」の注記を表示する", async () => {
    await renderWithCandidates([
      {
        kind: "place",
        destination: {
          destinationId: "pl_1",
          name: "一時休業中の店",
          category: "facility",
          address: "東京都テスト区1-1-1",
          latitude: 35.0,
          longitude: 139.0,
          nearestStationCandidates: [],
          businessStatus: "closed_temporarily",
        },
      },
    ]);

    expect(container.textContent).toContain("一時休業中");
  });

  test("公式サイトが確認できた施設候補には確認済みの注記を表示する", async () => {
    await renderWithCandidates([
      {
        kind: "place",
        destination: {
          destinationId: "pl_2",
          name: "公式サイトのある店",
          category: "facility",
          address: "東京都テスト区1-1-1",
          latitude: 35.0,
          longitude: 139.0,
          nearestStationCandidates: [],
          websiteUri: "https://example.com/",
        },
      },
    ]);

    expect(container.textContent).toContain("公式サイト確認済み");
  });

  test("営業中かつ公式サイト未確認の施設候補には注記を表示しない", async () => {
    await renderWithCandidates([
      {
        kind: "place",
        destination: {
          destinationId: "pl_3",
          name: "通常の店",
          category: "facility",
          address: "東京都テスト区1-1-1",
          latitude: 35.0,
          longitude: 139.0,
          nearestStationCandidates: [],
          businessStatus: "operational",
          websiteUri: null,
        },
      },
    ]);

    expect(container.textContent).not.toContain("一時休業中");
    expect(container.textContent).not.toContain("公式サイト確認済み");
  });
});
