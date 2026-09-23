import { describe, expect, test } from "vitest";
import { isScoringBothHit } from "@/lib/eval/both-hit";
import { lowConfidence } from "@/lib/domain/confidence";
import type { FacilityRecommendation } from "@/lib/domain/facility-recommendation";
import {
  classifyGateExitRelation,
  exitPresentationFor,
  GATE_EQUALS_EXIT_INSTRUCTION,
  GATE_EQUALS_EXIT_LABEL,
  hasSurfaceGateCue,
  looksLikeSubwayContext,
  EXIT_UNKNOWN_HARD_INSTRUCTION,
  EXIT_UNKNOWN_SOFT_INSTRUCTION,
  EXIT_UNKNOWN_SOFT_LABEL,
} from "@/lib/domain/gate-exit-relation";

describe("hasSurfaceGateCue", () => {
  test("階付き改札口は地上合図", () => {
    expect(hasSurfaceGateCue("2階改札口")).toBe(true);
    expect(hasSurfaceGateCue("１階改札")).toBe(true);
  });

  test("東口改札のような口改札は地上合図", () => {
    expect(hasSurfaceGateCue("東口改札")).toBe(true);
  });

  test("地下を含む改札は合図にしない", () => {
    expect(hasSurfaceGateCue("八重洲地下改札")).toBe(false);
    expect(hasSurfaceGateCue("2階地下改札口")).toBe(false);
    expect(hasSurfaceGateCue("B1階改札口")).toBe(false);
  });

  test("中央改札だけは合図にしない", () => {
    expect(hasSurfaceGateCue("中央改札")).toBe(false);
    expect(hasSurfaceGateCue("統合生成改札")).toBe(false);
  });

  test("地上の改札口表記は合図にする", () => {
    expect(hasSurfaceGateCue("博多改札口")).toBe(true);
    expect(hasSurfaceGateCue("地下1階 改札口")).toBe(false);
  });
});

describe("looksLikeSubwayContext", () => {
  test("地下鉄・メトロ・市営路線は地下鉄文脈", () => {
    expect(looksLikeSubwayContext("横浜市営地下鉄ブルーライン", "横浜市交通局")).toBe(true);
    expect(looksLikeSubwayContext("東京メトロ銀座線", "東京地下鉄")).toBe(true);
    expect(looksLikeSubwayContext("都営三田線", null)).toBe(true);
    expect(looksLikeSubwayContext("ブルーライン", "", ["横浜市ブルーライン"])).toBe(true);
    expect(looksLikeSubwayContext("東山線", "", ["名古屋市東山線"])).toBe(true);
  });

  test("相鉄・JRは地下鉄文脈にしない", () => {
    expect(looksLikeSubwayContext("相鉄本線", "", ["相鉄本線"])).toBe(false);
    expect(looksLikeSubwayContext("JR東海道線", "", ["JR東海道線"])).toBe(false);
    expect(looksLikeSubwayContext("相鉄本線", "", ["相鉄本線", "横浜市ブルーライン"])).toBe(false);
  });
});

describe("classifyGateExitRelation", () => {
  test("独立した出口名があれば separate_exit", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["南改札"],
      exitNames: ["A7出口"],
      arrivalLine: "相鉄本線",
      arrivalOperator: "相模鉄道",
      stationLines: ["相鉄本線"],
      knownSeparateExitCount: null,
    });
    expect(relation.kind).toBe("separate_exit");
  });

  test("西谷→横浜の2階改札口+相鉄は gate_equals_exit", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["2階改札口"],
      exitNames: [],
      arrivalLine: "相鉄本線",
      arrivalOperator: "",
      stationLines: ["相鉄本線", "横浜市ブルーライン"],
      knownSeparateExitCount: null,
    });
    expect(relation.kind).toBe("gate_equals_exit");
  });

  test("到着路線が空なら gate_equals_exit にしない", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["2階改札口"],
      exitNames: [],
      arrivalLine: null,
      arrivalOperator: "",
      stationLines: [],
      knownSeparateExitCount: null,
    });
    expect(relation.kind).toBe("exit_unknown");
    if (relation.kind === "exit_unknown") {
      expect(relation.missing).toBe("exit_only");
    }
  });

  test("収録に独立出口がある渋谷は改札だけでも exit_unknown", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["ハチ公改札"],
      exitNames: [],
      arrivalLine: "JR山手線",
      arrivalOperator: "",
      stationLines: ["JR山手線"],
      knownSeparateExitCount: 4,
    });
    expect(relation.kind).toBe("exit_unknown");
    expect(relation.reason).toContain("収録");
  });

  test("表参道改札口でも地下鉄なら exit_unknown", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["表参道改札口"],
      exitNames: [],
      arrivalLine: "銀座線",
      arrivalOperator: "",
      stationLines: ["東京メトロ銀座線"],
      knownSeparateExitCount: null,
    });
    expect(relation.kind).toBe("exit_unknown");
  });

  test("HeartRails の横浜市ブルーラインは市営なしでも exit_unknown", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["2階改札口"],
      exitNames: [],
      arrivalLine: "ブルーライン",
      arrivalOperator: "",
      stationLines: ["横浜市ブルーライン"],
      knownSeparateExitCount: null,
    });
    expect(relation.kind).toBe("exit_unknown");
  });

  test("地下改札は JR でも exit_unknown", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["八重洲地下改札"],
      exitNames: [],
      arrivalLine: "JR東海道線",
      arrivalOperator: "",
      stationLines: ["JR東海道線"],
      knownSeparateExitCount: null,
    });
    expect(relation.kind).toBe("exit_unknown");
  });

  test("中央改札だけの弱い合図は exit_unknown", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["中央改札"],
      exitNames: [],
      arrivalLine: "JR中央線",
      arrivalOperator: "",
      stationLines: ["JR中央線"],
      knownSeparateExitCount: null,
    });
    expect(relation.kind).toBe("exit_unknown");
  });

  test("東口改札+JRは gate_equals_exit", () => {
    const relation = classifyGateExitRelation({
      gateNames: ["東口改札"],
      exitNames: [],
      arrivalLine: "JR中央線",
      arrivalOperator: "",
      stationLines: ["JR中央線"],
      knownSeparateExitCount: 0,
    });
    expect(relation.kind).toBe("gate_equals_exit");
  });

  test("改札も出口も無ければ gate_and_exit", () => {
    const relation = classifyGateExitRelation({
      gateNames: [],
      exitNames: [],
      arrivalLine: "相鉄本線",
      arrivalOperator: null,
      stationLines: [],
      knownSeparateExitCount: null,
    });
    expect(relation).toMatchObject({ kind: "exit_unknown", missing: "gate_and_exit" });
  });
});

describe("exitPresentationFor", () => {
  test("gate_equals_exit は失敗文を出さず、recommendedExit に改札固有名を入れない", () => {
    const presentation = exitPresentationFor(
      { kind: "gate_equals_exit", reason: "test" },
      { exitNames: [], gateNames: ["2階改札口"], exitIsAlternatives: false, directionLabel: null }
    );
    expect(presentation.instruction).toBe(GATE_EQUALS_EXIT_INSTRUCTION);
    expect(presentation.recommendedExit).toBe(GATE_EQUALS_EXIT_LABEL);
    expect(presentation.overviewPrimary).toBe("2階改札口");
    expect(presentation.overviewSecondary).toBe(GATE_EQUALS_EXIT_LABEL);
    expect(presentation.instruction).not.toContain("確認できません");
  });

  test("改札がある本当の不明は失敗を弱める", () => {
    const presentation = exitPresentationFor(
      { kind: "exit_unknown", missing: "exit_only", reason: "test" },
      { exitNames: [], gateNames: ["中央改札"], exitIsAlternatives: false, directionLabel: null }
    );
    expect(presentation.instruction).toBe(EXIT_UNKNOWN_SOFT_INSTRUCTION);
    expect(presentation.recommendedExit).toBe(EXIT_UNKNOWN_SOFT_LABEL);
    expect(presentation.keyExitPhrase).toBe("出口名は確認できません");
  });

  test("改札も出口も無いときは従来の失敗文", () => {
    const presentation = exitPresentationFor(
      { kind: "exit_unknown", missing: "gate_and_exit", reason: "test" },
      { exitNames: [], gateNames: [], exitIsAlternatives: false, directionLabel: null }
    );
    expect(presentation.instruction).toBe(EXIT_UNKNOWN_HARD_INSTRUCTION);
    expect(presentation.recommendedExit).toBe("確認できません");
  });
});

describe("scoring bar stays honest", () => {
  test("gate_equals_exit でも facility に出口を足さなければ BothHit にならない", () => {
    const rec: FacilityRecommendation = {
      state: "confirmed",
      pair: {
        gate: { name: "2階改札口", confidence: lowConfidence("test") },
        exit: null,
        reason: null,
      },
    };
    expect(isScoringBothHit(rec)).toBe(false);
    expect(GATE_EQUALS_EXIT_LABEL).toBe("この改札が出口です");
  });
});
