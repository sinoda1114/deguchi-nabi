import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyInstructionCard } from "@/components/result/KeyInstructionCard";

describe("KeyInstructionCard", () => {
  test("モードバッジ・出発地/目的地・keyInstructionNodeを描画する", () => {
    const html = renderToStaticMarkup(
      <KeyInstructionCard
        mode="easy"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={false}
        keyInstructionNode={<span>テスト案内文</span>}
      />
    );
    expect(html).toContain("迷わないモード");
    expect(html).toContain("出発駅");
    expect(html).toContain("到着駅");
    expect(html).toContain("テスト案内文");
  });

  test("canSave=falseの場合はSaveRouteButtonを描画しない", () => {
    const html = renderToStaticMarkup(
      <KeyInstructionCard
        mode="easy"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={false}
        keyInstructionNode={<span>テスト案内文</span>}
      />
    );
    expect(html).not.toContain("ルートを保存");
  });

  test("canSave=trueの場合はSaveRouteButtonを描画する", () => {
    const html = renderToStaticMarkup(
      <KeyInstructionCard
        mode="fastest"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={true}
        keyInstructionNode={<span>テスト案内文</span>}
      />
    );
    expect(html).toContain("ルートを保存");
  });
});
