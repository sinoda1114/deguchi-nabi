import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveArrivalFacility } from "@/lib/services/arrival-facility-resolver";
import { UECHABE_DOGENZAKA } from "@/lib/eval/exit-quality-gate";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import { lowConfidence } from "@/lib/domain/confidence";

vi.mock("@/lib/integrations/osm/osm-subway-entrances", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/osm/osm-subway-entrances")>(
    "@/lib/integrations/osm/osm-subway-entrances"
  );
  return {
    ...actual,
    fetchOsmSubwayEntrances: vi.fn(async () => []),
  };
});

vi.mock("@/lib/integrations/ai/split-facility-generation", () => ({
  generateSplitFacilityPair: vi.fn(async () => ({ gate: null, exit: null, paired: false })),
}));

import { generateSplitFacilityPair } from "@/lib/integrations/ai/split-facility-generation";
import { fetchOsmSubwayEntrances } from "@/lib/integrations/osm/osm-subway-entrances";

describe("resolveArrivalFacility", () => {
  beforeEach(() => {
    vi.mocked(generateSplitFacilityPair).mockResolvedValue({ gate: null, exit: null, paired: false });
    vi.mocked(fetchOsmSubwayEntrances).mockResolvedValue([]);
  });

  test("渋谷+ウエチャベは収録だけで BothHit し Gemini last resort を呼ばない", async () => {
    const lastResort = vi.fn(async () => ({
      state: "unavailable" as const,
      reason: "should not run",
    }));
    const result = await resolveArrivalFacility({
      stationId: "hr_渋谷_139.7016_35.6580",
      stationName: "渋谷駅",
      stationCoordinates: { lat: 35.65861, lng: 139.70111 },
      destinationHint: UECHABE_DOGENZAKA.label,
      destinationCoordinates: UECHABE_DOGENZAKA.coordinates,
      geminiApiKey: "test-key",
      lastResortFacility: lastResort,
    });
    expect(isScoringBothHit(result.recommendation)).toBe(true);
    expect(result.usedGeminiFinal).toBe(false);
    expect(lastResort).not.toHaveBeenCalled();
    expect(generateSplitFacilityPair).not.toHaveBeenCalled();
  });

  test("収録の無い駅は last resort のみ(分割生成しない)", async () => {
    const lastResort = vi.fn(async () => ({
      state: "confirmed" as const,
      pair: {
        gate: { name: "中央改札", confidence: lowConfidence("ai"), provenance: "ai_inferred" as const },
        exit: { name: "西口", confidence: lowConfidence("ai"), provenance: "ai_inferred" as const },
        reason: null,
      },
    }));
    const result = await resolveArrivalFacility({
      stationId: "st_yokohama",
      stationName: "横浜駅",
      stationCoordinates: { lat: 35.466, lng: 139.622 },
      destinationHint: "カフェ",
      destinationCoordinates: { lat: 35.465, lng: 139.622 },
      geminiApiKey: "test-key",
      lastResortFacility: lastResort,
    });
    expect(lastResort).toHaveBeenCalledOnce();
    expect(generateSplitFacilityPair).not.toHaveBeenCalled();
    expect(isScoringBothHit(result.recommendation)).toBe(true);
    expect(result.usedGeminiFinal).toBe(true);
  });

  test("渋谷でも目的地座標が無いときは収録を使わず last resort のみ", async () => {
    const lastResort = vi.fn(async () => ({
      state: "unavailable" as const,
      reason: "gemini",
    }));
    const result = await resolveArrivalFacility({
      stationId: "hr_渋谷_139.7016_35.6580",
      stationName: "渋谷駅",
      stationCoordinates: { lat: 35.65861, lng: 139.70111 },
      destinationHint: null,
      destinationCoordinates: null,
      geminiApiKey: "test-key",
      lastResortFacility: lastResort,
    });
    expect(lastResort).toHaveBeenCalledOnce();
    expect(generateSplitFacilityPair).not.toHaveBeenCalled();
    expect(result.usedGeminiFinal).toBe(true);
    expect(isScoringBothHit(result.recommendation)).toBe(false);
  });
});
