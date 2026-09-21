// @vitest-environment jsdom
import { describe, expect, test, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Station } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const NISHIYA: Station = {
  stationId: "st_nishiya",
  stationName: "西谷駅",
  operator: "相模鉄道",
  lines: ["相鉄本線"],
  prefecture: "神奈川県",
  latitude: 35.4696,
  longitude: 139.5679,
};

const NAGOYA: Station = {
  stationId: "st_nagoya",
  stationName: "名古屋駅",
  operator: "東海旅客鉄道",
  lines: ["東海道新幹線"],
  prefecture: "愛知県",
  latitude: 35.170915,
  longitude: 136.881537,
};

const USER: User = {
  userId: "u1",
  email: "a@example.com",
  displayName: "テスト太郎",
  homeStationId: NISHIYA.stationId,
  plan: "free",
  locale: "ja",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function placesSearchUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes("/api/places/search"));
}

function lastPlacesSearchParams(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams | null {
  const urls = placesSearchUrls(fetchMock);
  const last = urls.at(-1);
  if (!last) return null;
  return new URL(last, "http://localhost").searchParams;
}

describe("SearchForm 目的地検索の位置バイアスは選択中の出発地に追従する", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalFetch = global.fetch;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    global.fetch = originalFetch;
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderForm() {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/stations/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ stations: [NAGOYA] }),
        } as Response);
      }
      if (url.includes("/api/places/search")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ candidates: [] }),
        } as Response);
      }
      if (url.includes(`/api/stations/${encodeURIComponent(NAGOYA.stationId)}`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ station: NAGOYA }),
        } as Response);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { SearchForm } = await import("../SearchForm");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(<SearchForm user={USER} homeStation={NISHIYA} favoriteDestinations={[]} />);
    });

    return fetchMock;
  }

  test("登録駅が出発地のときは目的地検索に登録駅の lat/lng を付ける", async () => {
    const fetchMock = await renderForm();
    const destInput = container.querySelector('input[aria-label="目的地"]') as HTMLInputElement;

    act(() => {
      destInput.dispatchEvent(new Event("focus", { bubbles: true }));
      typeInto(destInput, "焼肉ワガママ気まま");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const params = lastPlacesSearchParams(fetchMock);
    expect(params).not.toBeNull();
    expect(params?.get("q")).toBe("焼肉ワガママ気まま");
    expect(params?.get("lat")).toBe(String(NISHIYA.latitude));
    expect(params?.get("lng")).toBe(String(NISHIYA.longitude));
  });

  test("登録駅と違う出発駅を選ぶと目的地検索はその駅の lat/lng を使う(登録駅座標には戻さない)", async () => {
    const fetchMock = await renderForm();
    const originInput = container.querySelector(
      'input[aria-label="出発駅を検索"]'
    ) as HTMLInputElement;

    act(() => {
      typeInto(originInput, "名古屋");
    });
    await act(async () => {
      await Promise.resolve();
    });

    const nagoyaButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === NAGOYA.stationName
    );
    expect(nagoyaButton).toBeDefined();
    act(() => {
      nagoyaButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const destInput = container.querySelector('input[aria-label="目的地"]') as HTMLInputElement;
    act(() => {
      destInput.dispatchEvent(new Event("focus", { bubbles: true }));
      typeInto(destInput, "焼肉ワガママ気まま");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const params = lastPlacesSearchParams(fetchMock);
    expect(params).not.toBeNull();
    expect(params?.get("q")).toBe("焼肉ワガママ気まま");
    expect(params?.get("lat")).toBe(String(NAGOYA.latitude));
    expect(params?.get("lng")).toBe(String(NAGOYA.longitude));
    expect(params?.get("lat")).not.toBe(String(NISHIYA.latitude));
    expect(params?.get("lng")).not.toBe(String(NISHIYA.longitude));
  });
});
