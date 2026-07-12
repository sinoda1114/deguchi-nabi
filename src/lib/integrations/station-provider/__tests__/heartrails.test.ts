import { afterEach, describe, expect, test, vi } from "vitest";
import { searchStationsFromHeartRails } from "../heartrails";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("searchStationsFromHeartRails", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("name パラメータでHeartRails APIを呼び、路線ごとの重複エントリを駅単位にグルーピングする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        response: {
          station: [
            {
              name: "名古屋",
              prefecture: "愛知県",
              line: "JR東海道本線",
              x: 136.881637,
              y: 35.170694,
              postal: "4510045",
            },
            {
              name: "名古屋",
              prefecture: "愛知県",
              line: "JR中央本線",
              x: 136.881637,
              y: 35.170694,
              postal: "4510045",
            },
          ],
        },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await searchStationsFromHeartRails("名古屋");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("method=getStations");
    expect(calledUrl).toContain("name=");
    expect(calledUrl).not.toContain("x=");

    expect(result).toHaveLength(1);
    expect(result?.[0].stationName).toBe("名古屋駅");
    expect(result?.[0].prefecture).toBe("愛知県");
    expect(result?.[0].lines).toEqual(
      expect.arrayContaining(["JR東海道本線", "JR中央本線"])
    );
  });

  test("空文字クエリはAPIを呼ばずnullを返す", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await searchStationsFromHeartRails("  ");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  test("APIエラー時はnullを返す(例外を投げない)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error")) as unknown as typeof fetch;

    const result = await searchStationsFromHeartRails("名古屋");

    expect(result).toBeNull();
  });

  test("HTTPエラーレスポンスはnullを返す", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false } as Response) as unknown as typeof fetch;

    const result = await searchStationsFromHeartRails("名古屋");

    expect(result).toBeNull();
  });

  test("該当駅が0件ならnullを返す", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ response: { station: [] } })
    ) as unknown as typeof fetch;

    const result = await searchStationsFromHeartRails("存在しない駅名");

    expect(result).toBeNull();
  });

  test("クエリ内の記号(&, #, ?, %)がURLパラメータとして正しくエンコードされる", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ response: { station: [] } })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchStationsFromHeartRails("A&B#C?D%E");

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    const parsed = new URL(calledUrl);
    expect(parsed.searchParams.get("name")).toBe("A&B#C?D%E");
  });

  test("50文字以内のクエリはAPIを呼ぶ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ response: { station: [] } })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchStationsFromHeartRails("あ".repeat(50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("50文字を超えるクエリはAPIを呼ばずnullを返す", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await searchStationsFromHeartRails("あ".repeat(51));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
