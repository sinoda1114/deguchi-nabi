import { describe, expect, test, vi, beforeEach } from "vitest";
import { enrichPartialFacilityPair } from "@/lib/services/arrival-facility-enrichment";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import { lowConfidence } from "@/lib/domain/confidence";

vi.mock("@/lib/integrations/ai/split-facility-generation", () => ({
  generateExitOnly: vi.fn(),
  generateGateOnly: vi.fn(),
  generateSplitFacilityPair: vi.fn(),
}));

import {
  generateExitOnly,
  generateGateOnly,
  generateSplitFacilityPair,
} from "@/lib/integrations/ai/split-facility-generation";

const BASE_INPUT = {
  stationName: "栄駅",
  stationCoordinates: { lat: 35.17, lng: 136.908 },
  destinationHint: "焼肉ワガママ気まま",
  destinationCoordinates: { lat: 35.169, lng: 136.907 },
  geminiApiKey: "test-key",
};

describe("enrichPartialFacilityPair", () => {
  beforeEach(() => {
    vi.mocked(generateExitOnly).mockReset();
    vi.mocked(generateGateOnly).mockReset();
    vi.mocked(generateSplitFacilityPair).mockReset();
  });

  test("改札だけ確定のとき接続改札が一致する出口を補完する", async () => {
    vi.mocked(generateExitOnly).mockResolvedValue({
      exit: {
        name: "8番出入口",
        confidence: lowConfidence("ai"),
        provenance: "ai_inferred",
      },
      pairedGateName: "西改札口",
    });

    const result = await enrichPartialFacilityPair(BASE_INPUT, {
      state: "confirmed",
      pair: {
        gate: {
          name: "西改札口",
          confidence: lowConfidence("ai"),
          provenance: "ai_inferred",
        },
        exit: null,
        reason: "単一呼び出しで改札のみ",
      },
    });

    expect(isScoringBothHit(result)).toBe(true);
    if (result.state === "confirmed") {
      expect(result.pair.exit?.name).toBe("8番出入口");
      expect(result.pair.gate?.name).toBe("西改札口");
    }
  });

  test("接続改札が一致しないとき確定改札を別ペアで置き換えない", async () => {
    vi.mocked(generateExitOnly).mockResolvedValue({
      exit: {
        name: "8番出入口",
        confidence: lowConfidence("ai"),
        provenance: "ai_inferred",
      },
      pairedGateName: "矢場改札",
    });
    vi.mocked(generateSplitFacilityPair).mockResolvedValue({
      gate: {
        name: "矢場改札",
        confidence: lowConfidence("ai"),
        provenance: "ai_inferred",
      },
      exit: {
        name: "8番出入口",
        confidence: lowConfidence("ai"),
        provenance: "ai_inferred",
      },
      paired: true,
    });

    const partial = {
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
    };

    const result = await enrichPartialFacilityPair(BASE_INPUT, partial);
    expect(isScoringBothHit(result)).toBe(false);
    expect(result).toEqual(partial);
  });
});
