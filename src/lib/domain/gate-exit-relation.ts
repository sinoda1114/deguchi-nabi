/**
 * 改札が地上出口を兼ねる駅(改札＝出口)の保守的判定。
 *
 * 欠落した出口を成功扱いにしない。PR #133 Option A(gate-only 成功化)は
 * 不採用のまま。この判定は案内コピー専用であり、isScoringBothHit /
 * TripleHit(乗車 AND 改札 AND 出口の具体名)は出口名が無い限り不合格のまま。
 *
 * 都市名では分岐しない(徒歩分数と同じ)。到着路線・改札名の形・収録出口数
 * だけを見る。
 */

export type GateExitRelationKind = "separate_exit" | "gate_equals_exit" | "exit_unknown";

export interface GateExitRelation {
  kind: GateExitRelationKind;
  reason: string;
}

export interface GateExitRelationInput {
  gateNames: readonly string[];
  exitNames: readonly string[];
  /** 到着駅直前の乗車路線。地下鉄判定に使う。 */
  arrivalLine: string | null;
  /** 到着駅の事業者名。地下鉄判定の補助。 */
  arrivalOperator: string | null;
  /**
   * 収録カタログ等で分かっている独立した出口数。
   * null は未知(0 とはみなさない)。1 以上なら改札＝出口にしない。
   */
  knownSeparateExitCount: number | null;
}

export const GATE_EQUALS_EXIT_LABEL = "この改札が出口です";
export const GATE_EQUALS_EXIT_INSTRUCTION = "この改札が出口です。改札を出ると地上です。";
export const EXIT_UNKNOWN_SOFT_INSTRUCTION =
  "出口名は確認できません。改札を出て目的地へ向かってください。";
export const EXIT_UNKNOWN_HARD_INSTRUCTION = "出口は確認できません。";

const SUBWAY_HINT = /地下鉄|メトロ|Metro|都営/i;
const UNDERGROUND = /地下/;
const FLOOR_OR_SURFACE = /[1-9]階|地上/;
const NAMED_EXIT_GATE = /口改札/;

export function looksLikeSubwayContext(line: string | null, operator: string | null): boolean {
  return SUBWAY_HINT.test(`${line ?? ""} ${operator ?? ""}`);
}

export function hasSurfaceGateCue(name: string): boolean {
  const normalized = name.normalize("NFKC");
  if (UNDERGROUND.test(normalized)) return false;
  return FLOOR_OR_SURFACE.test(normalized) || NAMED_EXIT_GATE.test(normalized);
}

export function classifyGateExitRelation(input: GateExitRelationInput): GateExitRelation {
  if (input.exitNames.length > 0) {
    return { kind: "separate_exit", reason: "独立した出口名がある" };
  }
  if (input.gateNames.length === 0) {
    return { kind: "exit_unknown", reason: "改札も出口も無い" };
  }
  if ((input.knownSeparateExitCount ?? 0) > 0) {
    return {
      kind: "exit_unknown",
      reason: "収録に独立した出口があるので改札＝出口にしない",
    };
  }
  if (looksLikeSubwayContext(input.arrivalLine, input.arrivalOperator)) {
    return {
      kind: "exit_unknown",
      reason: "地下鉄・メトロ文脈では改札の先に番号出口があることが多い",
    };
  }
  if (!input.gateNames.every(hasSurfaceGateCue)) {
    return {
      kind: "exit_unknown",
      reason: "改札名に地上・階・口改札の合図が揃っていない",
    };
  }
  return {
    kind: "gate_equals_exit",
    reason: "地上改札の合図があり、独立出口も地下鉄文脈も無い",
  };
}

export function exitInstructionFor(relation: GateExitRelation, exitIsAlternatives: boolean, exitNames: readonly string[]): string {
  switch (relation.kind) {
    case "separate_exit":
      return exitIsAlternatives
        ? `利用できる出口: ${exitNames.join(" / ")}(いずれか。現地の案内表示でご確認ください)。`
        : `${exitNames[0]}から出てください。`;
    case "gate_equals_exit":
      return GATE_EQUALS_EXIT_INSTRUCTION;
    case "exit_unknown":
      return relation.reason === "改札も出口も無い"
        ? EXIT_UNKNOWN_HARD_INSTRUCTION
        : EXIT_UNKNOWN_SOFT_INSTRUCTION;
    default: {
      const _exhaustive: never = relation.kind;
      return _exhaustive;
    }
  }
}

export function recommendedExitFor(
  relation: GateExitRelation,
  exitIsAlternatives: boolean,
  exitNames: readonly string[],
  gateNames: readonly string[]
): string {
  switch (relation.kind) {
    case "separate_exit":
      return exitIsAlternatives ? `${exitNames.join(" / ")}(いずれか)` : exitNames[0] ?? "確認できません";
    case "gate_equals_exit":
      return gateNames[0] ?? GATE_EQUALS_EXIT_LABEL;
    case "exit_unknown":
      return relation.reason === "改札も出口も無い" ? "確認できません" : "出口名は未確認";
    default: {
      const _exhaustive: never = relation.kind;
      return _exhaustive;
    }
  }
}
