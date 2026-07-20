import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const storeState: Record<string, unknown[]> = {};

vi.mock("@/lib/store/json-file-store", () => ({
  readCollection: vi.fn((name: string) => storeState[name] ?? []),
  writeCollection: vi.fn((name: string, items: unknown[]) => {
    storeState[name] = items;
  }),
}));

const { createUser, getUserById, setHomeStation } = await import("../user-repository");

describe("user-repository homeStationId互換性(fixture廃止2026-07-20)", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeState)) delete storeState[key];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("旧fixture形式(st_接頭辞)のhomeStationIdは読み出し時にnullとして扱う(AiStationAdapterでは解決不能なため)", () => {
    const user = createUser("test@example.com", "password123");
    setHomeStation(user.userId, "st_nishiya");

    const result = getUserById(user.userId);

    expect(result?.homeStationId).toBeNull();
  });

  test("HeartRails形式(hr_接頭辞)のhomeStationIdはそのまま返す", () => {
    const user = createUser("test@example.com", "password123");
    setHomeStation(user.userId, "hr_%E8%A5%BF%E8%B0%B7_139.5679_35.4696");

    const result = getUserById(user.userId);

    expect(result?.homeStationId).toBe("hr_%E8%A5%BF%E8%B0%B7_139.5679_35.4696");
  });

  test("homeStationId未設定(null)はそのままnullを返す", () => {
    const user = createUser("test@example.com", "password123");

    const result = getUserById(user.userId);

    expect(result?.homeStationId).toBeNull();
  });
});
