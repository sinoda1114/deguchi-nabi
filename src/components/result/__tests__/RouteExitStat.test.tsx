import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteExitStat } from "@/components/result/RouteExitStat";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import type { Confidence } from "@/lib/domain/confidence";

const highConfidence: Confidence = {
  level: "high",
  reasons: [],
  verifiedAt: null,
  expiresAt: null,
  sourceCount: 2,
};

const OK_RESULT: FacilitiesSearchResult = {
  ok: true,
  result: {
    transferSegment: {
      type: "transfer",
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: "中央改札方面",
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "中央改札へ向かってください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    exitSegment: {
      type: "exit",
      from: "到着駅",
      to: "到着駅",
      line: null,
      direction: null,
      platform: null,
      boardingPosition: null,
      facilities: [],
      instruction: "東口から出てください。",
      confidence: highConfidence,
      sourceReferences: [],
      warnings: [],
    },
    recommendedExit: "東口",
    gate: null,
    exit: null,
    elevator: null,
    hasApproximateGuidance: false,
    approximateDirectionLabel: null,
  },
};

const NG_RESULT: FacilitiesSearchResult = {
  ok: false,
  reason: "改札・出口情報を確認できません。",
};

describe("RouteExitStat", () => {
  test("推奨出口を表示する", async () => {
    const element = await RouteExitStat({ facilitiesPromise: Promise.resolve(OK_RESULT) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("東口");
  });

  test("facilitiesがok:falseの場合は確認できない旨を表示する", async () => {
    const element = await RouteExitStat({ facilitiesPromise: Promise.resolve(NG_RESULT) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("確認できません");
  });
});
