import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteOverviewCard } from "@/components/result/RouteOverviewCard";

describe("RouteOverviewCard", () => {
  test("モードバッジ・出発地/目的地・overviewContentNodeを描画する", () => {
    const html = renderToStaticMarkup(
      <RouteOverviewCard
        mode="easy"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={false}
        estimatedDurationMinutes={39}
        walkingMinutes={null}
        overviewContentNode={<span>テスト概要</span>}
      />
    );
    expect(html).toContain("迷わないモード");
    expect(html).toContain("出発駅");
    expect(html).toContain("到着駅");
    expect(html).toContain("テスト概要");
  });

  test("所要時間を表示する", () => {
    const html = renderToStaticMarkup(
      <RouteOverviewCard
        mode="easy"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={false}
        estimatedDurationMinutes={39}
        walkingMinutes={null}
        overviewContentNode={<span>テスト概要</span>}
      />
    );
    expect(html).toContain("約39分");
  });

  test("所要時間が確認できない(null)場合はその旨を表示する", () => {
    const html = renderToStaticMarkup(
      <RouteOverviewCard
        mode="easy"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={false}
        estimatedDurationMinutes={null}
        walkingMinutes={null}
        overviewContentNode={<span>テスト概要</span>}
      />
    );
    expect(html).toContain("確認できません");
  });

  test("canSave=falseの場合はSaveRouteButtonを描画しない", () => {
    const html = renderToStaticMarkup(
      <RouteOverviewCard
        mode="easy"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={false}
        estimatedDurationMinutes={39}
        walkingMinutes={null}
        overviewContentNode={<span>テスト概要</span>}
      />
    );
    expect(html).not.toContain("ルートを保存");
  });

  test("canSave=trueの場合はSaveRouteButtonを描画する", () => {
    const html = renderToStaticMarkup(
      <RouteOverviewCard
        mode="fastest"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={true}
        estimatedDurationMinutes={39}
        walkingMinutes={null}
        overviewContentNode={<span>テスト概要</span>}
      />
    );
    expect(html).toContain("ルートを保存");
  });

  test("walkingMinutesがある場合、乗車時間+徒歩時間の合計目安を表示する", () => {
    const html = renderToStaticMarkup(
      <RouteOverviewCard
        mode="easy"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={false}
        estimatedDurationMinutes={10}
        walkingMinutes={3}
        overviewContentNode={<span>テスト概要</span>}
      />
    );
    expect(html).toContain("約13分");
    expect(html).toContain("乗車約10分");
    expect(html).toContain("到着駅からの徒歩目安約3分");
  });

  test("walkingMinutesがnullの場合、合計目安は表示しない(乗車時間のみ)", () => {
    const html = renderToStaticMarkup(
      <RouteOverviewCard
        mode="easy"
        routeId="route_1"
        originName="出発駅"
        destinationName="到着駅"
        originStationId="origin"
        destinationStationId="destination"
        canSave={false}
        estimatedDurationMinutes={10}
        walkingMinutes={null}
        overviewContentNode={<span>テスト概要</span>}
      />
    );
    expect(html).not.toContain("目的地到着まで");
  });
});
