// @vitest-environment jsdom
import { describe, expect, test, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OriginField } from "@/components/search/OriginField";
import type { Station } from "@/lib/domain/station";
import type { User } from "@/lib/domain/user";

// React 19のact()はjsdom環境下でこのフラグを見て、非同期state更新の警告要否を判定する。
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const STATION: Station = {
  stationId: "st_nishiya",
  stationName: "西谷駅",
  operator: "相模鉄道",
  lines: ["相鉄本線"],
  prefecture: "神奈川県",
  latitude: 35.4696,
  longitude: 139.5679,
};

const USER: User = {
  userId: "u1",
  email: "a@example.com",
  displayName: "テスト太郎",
  homeStationId: "st_nishiya",
  plan: "free",
  locale: "ja",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function findHomeStationButton(container: HTMLDivElement, station: Station): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(station.stationName)
  );
  if (!button) throw new Error("実効ホーム駅ボタンが見つかりません");
  return button as HTMLButtonElement;
}

describe("OriginField 実効ホーム駅ボタン(サーバー側 resolveOriginDestination の解釈との整合性回帰確認)", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("未ログイン時にボタンを押すと type: station で onChange を呼ぶ(type: home_station は使わない)", () => {
    const onChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <OriginField
          user={null}
          homeStation={null}
          value={null}
          onChange={onChange}
          localDefaultStation={STATION}
          onSetLocalDefaultStation={vi.fn()}
        />
      );
    });

    const button = findHomeStationButton(container, STATION);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({
      type: "station",
      stationId: "st_nishiya",
      label: "西谷駅",
    });
  });

  test("ログイン時にボタンを押すと type: home_station で onChange を呼ぶ(従来通り)", () => {
    const onChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <OriginField
          user={USER}
          homeStation={STATION}
          value={null}
          onChange={onChange}
          localDefaultStation={null}
          onSetLocalDefaultStation={vi.fn()}
        />
      );
    });

    const button = findHomeStationButton(container, STATION);
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({ type: "home_station", label: "西谷駅" });
  });
});
