import { describe, expect, test } from "vitest";
import { buildReturnRouteUrl } from "@/lib/services/return-route-link";

describe("buildReturnRouteUrl", () => {
  test("出発駅と到着駅を入れ替えたstation→station形式のURLを組み立てる", () => {
    const url = buildReturnRouteUrl("st_shibuya", "st_nishiya", "easy");

    expect(url).toBe(
      "/routes/result?originType=station&originStationId=st_nishiya&destinationType=station&destinationId=st_shibuya&mode=easy"
    );
  });

  test("modeがfastest/accessibleでもそのまま反映される", () => {
    expect(buildReturnRouteUrl("a", "b", "fastest")).toContain("mode=fastest");
    expect(buildReturnRouteUrl("a", "b", "accessible")).toContain("mode=accessible");
  });

  test("駅IDに記号が含まれていてもURLエンコードされる", () => {
    const url = buildReturnRouteUrl("st a&b", "st c=d", "easy");

    expect(url).toContain("originStationId=st+c%3Dd");
    expect(url).toContain("destinationId=st+a%26b");
  });
});
