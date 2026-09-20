import { describe, expect, test } from "vitest";
import {
  boardingAgreesWithChosenGate,
  gateNameStem,
  reasonCitesGate,
  sharedBoardingFitsChosenGate,
} from "@/lib/domain/boarding-gate-agreement";

const SIBLINGS = ["道玄坂改札", "ハチ公改札", "ヒカリエ改札", "宮益坂改札"];

describe("gateNameStem", () => {
  test("改札・口を落とす", () => {
    expect(gateNameStem("道玄坂改札")).toBe("道玄坂");
    expect(gateNameStem("ハチ公口")).toBe("ハチ公");
  });
});

describe("reasonCitesGate", () => {
  test("正式名を含む", () => {
    expect(reasonCitesGate("道玄坂改札に近いため", "道玄坂改札")).toBe(true);
  });

  test("語幹（道玄坂）だけでも引用とみなす", () => {
    expect(reasonCitesGate("道玄坂方面の階段に近い8号車", "道玄坂改札")).toBe(true);
  });

  test("改札名も語幹も無い一般理由は引用しない", () => {
    expect(reasonCitesGate("階段に近いため", "道玄坂改札")).toBe(false);
  });
});

describe("boardingAgreesWithChosenGate", () => {
  test("他改札に触れない号車は採用する（同一検索の目的地込み号車）", () => {
    expect(boardingAgreesWithChosenGate("階段に近いため", "道玄坂改札", SIBLINGS)).toBe(true);
  });

  test("選んだ改札の語幹があれば採用する", () => {
    expect(
      boardingAgreesWithChosenGate("道玄坂方面の階段に近い", "道玄坂改札", SIBLINGS)
    ).toBe(true);
  });

  test("他改札だけを理由にしている号車は捨てる", () => {
    expect(
      boardingAgreesWithChosenGate("ハチ公改札の階段に近いため", "道玄坂改札", SIBLINGS)
    ).toBe(false);
  });
});

describe("sharedBoardingFitsChosenGate", () => {
  test(".first が別改札を断定し reason が選んだ改札を指さないなら捨てる", () => {
    expect(
      sharedBoardingFitsChosenGate({
        reason: "階段に近いため",
        chosenGateName: "道玄坂改札",
        siblingGateNames: SIBLINGS,
        firstFacilityGateName: "ハチ公改札",
      })
    ).toBe(false);
  });

  test(".first 施設が無い一般理由は採用する", () => {
    expect(
      sharedBoardingFitsChosenGate({
        reason: "階段に近いため",
        chosenGateName: "道玄坂改札",
        siblingGateNames: SIBLINGS,
        firstFacilityGateName: null,
      })
    ).toBe(true);
  });
});
