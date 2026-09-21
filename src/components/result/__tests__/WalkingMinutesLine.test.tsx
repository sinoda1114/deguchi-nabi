import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WalkingMinutesLine, walkingOriginPhrase } from "@/components/result/WalkingMinutesLine";

describe("WalkingMinutesLine", () => {
  test("起点種別に応じた目安文言で合計を出す", () => {
    const html = renderToStaticMarkup(
      <WalkingMinutesLine
        estimatedDurationMinutes={10}
        walkingMinutes={2}
        originKind="exit"
      />
    );
    expect(html).toContain("目的地到着まで目安約12分");
    expect(html).toContain("乗車約10分");
    expect(html).toContain("出口からの徒歩目安約2分");
    expect(html).not.toContain("到着駅からの徒歩目安約2分");
  });

  test("駅代表起点では到着駅からの、と明記する", () => {
    const html = renderToStaticMarkup(
      <WalkingMinutesLine
        estimatedDurationMinutes={10}
        walkingMinutes={6}
        originKind="station"
      />
    );
    expect(html).toContain("到着駅からの徒歩目安約6分");
  });

  test("乗車または徒歩がnullなら行を出さない", () => {
    expect(
      renderToStaticMarkup(
        <WalkingMinutesLine
          estimatedDurationMinutes={10}
          walkingMinutes={null}
          originKind="station"
        />
      )
    ).toBe("");
  });

  test("walkingOriginPhrase は網羅的に起点を返す", () => {
    expect(walkingOriginPhrase("exit")).toBe("出口からの");
    expect(walkingOriginPhrase("gate")).toBe("改札からの");
    expect(walkingOriginPhrase("station")).toBe("到着駅からの");
  });
});
