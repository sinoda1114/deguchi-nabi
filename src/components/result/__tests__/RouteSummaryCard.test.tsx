import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteSummaryCard } from "@/components/result/RouteSummaryCard";

describe("RouteSummaryCard", () => {
  test("出発地・目的地・降車駅・推奨出口・所要時間・乗換回数を描画する", () => {
    const html = renderToStaticMarkup(
      <RouteSummaryCard
        originName="出発駅"
        destinationName="到着駅"
        arrivalStationName="到着駅"
        recommendedExitNode={<span>A1出口</span>}
        estimatedDurationMinutes={15}
        transferCount={1}
      />
    );
    expect(html).toContain("出発駅");
    expect(html).toContain("到着駅");
    expect(html).toContain("A1出口");
    expect(html).toContain("約15分");
    expect(html).toContain("1回");
  });

  test("estimatedDurationMinutesがnullの場合は確認できません表記になる", () => {
    const html = renderToStaticMarkup(
      <RouteSummaryCard
        originName="出発駅"
        destinationName="到着駅"
        arrivalStationName="到着駅"
        recommendedExitNode={<span>確認できません</span>}
        estimatedDurationMinutes={null}
        transferCount={0}
      />
    );
    expect(html).toContain("確認できません");
  });
});
