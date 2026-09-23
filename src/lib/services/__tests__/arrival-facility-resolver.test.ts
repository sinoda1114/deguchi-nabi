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
  generateExitOnly: vi.fn(async () => ({ exit: null, pairedGateName: null })),
  generateGateOnly: vi.fn(async () => ({ gate: null, pairedExitName: null })),
}));

import {
  generateExitOnly,
  generateSplitFacilityPair,
} from "@/lib/integrations/ai/split-facility-generation";
import { fetchOsmSubwayEntrances } from "@/lib/integrations/osm/osm-subway-entrances";

describe("resolveArrivalFacility", () => {
  beforeEach(() => {
    vi.mocked(generateSplitFacilityPair).mockClear();
    vi.mocked(generateSplitFacilityPair).mockResolvedValue({ gate: null, exit: null, paired: false });
    vi.mocked(generateExitOnly).mockClear();
    vi.mocked(generateExitOnly).mockResolvedValue({ exit: null, pairedGateName: null });
    vi.mocked(fetchOsmSubwayEntrances).mockClear();
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

  test("収録の無い駅も OSM と分割生成を試してから last resort する", async () => {
    vi.mocked(fetchOsmSubwayEntrances).mockResolvedValue([]);
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
    expect(generateSplitFacilityPair).toHaveBeenCalledOnce();
    expect(isScoringBothHit(result.recommendation)).toBe(true);
    expect(result.usedGeminiFinal).toBe(true);
  });

  test("収録の無い駅で last resort が改札のみのとき OSM 出口とペアできる", async () => {
    vi.mocked(fetchOsmSubwayEntrances).mockResolvedValue([
      { osmId: "osm_east", name: "東口", coordinates: { lat: 35.9065, lng: 139.626 } },
    ]);
    const lastResort = vi.fn(async () => ({
      state: "confirmed" as const,
      pair: {
        gate: {
          name: "中央改札",
          confidence: lowConfidence("ai"),
          provenance: "ai_inferred" as const,
        },
        exit: null,
        reason: null,
      },
    }));
    vi.mocked(generateExitOnly).mockResolvedValue({ exit: null, pairedGateName: null });

    const result = await resolveArrivalFacility({
      stationId: "hr_大宮_139.6241_35.9064",
      stationName: "大宮駅",
      stationCoordinates: { lat: 35.9064, lng: 139.6241 },
      destinationHint: "店",
      destinationCoordinates: { lat: 35.9065, lng: 139.626 },
      geminiApiKey: "test-key",
      lastResortFacility: lastResort,
    });

    expect(isScoringBothHit(result.recommendation)).toBe(true);
    expect(result.knownSeparateExitCount).toBe(1);
    if (result.recommendation.state === "confirmed") {
      expect(result.recommendation.pair.exit?.name).toBe("東口");
    }
  });

  test("収録の無い駅で last resort が改札のみのとき出口を補完する", async () => {
    const lastResort = vi.fn(async () => ({
      state: "confirmed" as const,
      pair: {
        gate: {
          name: "西改札口",
          confidence: lowConfidence("ai"),
          provenance: "ai_inferred" as const,
        },
        exit: null,
        reason: null,
      },
    }));
    vi.mocked(generateExitOnly).mockResolvedValue({
      exit: {
        name: "8番出入口",
        confidence: lowConfidence("ai"),
        provenance: "ai_inferred",
      },
      pairedGateName: "西改札口",
    });

    const result = await resolveArrivalFacility({
      stationId: "hr_栄_136.9080_35.1700",
      stationName: "栄駅",
      stationCoordinates: { lat: 35.17, lng: 136.908 },
      destinationHint: "焼肉ワガママ気まま",
      destinationCoordinates: { lat: 35.169, lng: 136.907 },
      geminiApiKey: "test-key",
      lastResortFacility: lastResort,
    });

    expect(lastResort).toHaveBeenCalledOnce();
    expect(isScoringBothHit(result.recommendation)).toBe(true);
    if (result.recommendation.state === "confirmed") {
      expect(result.recommendation.pair.exit?.name).toBe("8番出入口");
    }
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
