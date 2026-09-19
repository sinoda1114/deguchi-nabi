import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";

vi.mock("@/lib/integrations/jev/JevClient", () => ({
  checkJevHealth: vi.fn(),
}));

describe("GET /api/health/jev", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("JEVヘルスチェックが成功した場合は200を返す", async () => {
    const { checkJevHealth } = await import("@/lib/integrations/jev/JevClient");
    vi.mocked(checkJevHealth).mockResolvedValue({ ok: true });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
  });

  it("JEV_API_KEYが未設定の場合は503を返す", async () => {
    const { checkJevHealth } = await import("@/lib/integrations/jev/JevClient");
    vi.mocked(checkJevHealth).mockResolvedValue({ ok: false, error: "missing_key" });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({ ok: false, reason: "missing_key" });
  });

  it("上流エラーの場合は502を返す", async () => {
    const { checkJevHealth } = await import("@/lib/integrations/jev/JevClient");
    vi.mocked(checkJevHealth).mockResolvedValue({ ok: false, error: "upstream_error" });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("タイムアウトの場合は502を返す", async () => {
    const { checkJevHealth } = await import("@/lib/integrations/jev/JevClient");
    vi.mocked(checkJevHealth).mockResolvedValue({ ok: false, error: "timeout" });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({ ok: false, reason: "timeout" });
  });
});
