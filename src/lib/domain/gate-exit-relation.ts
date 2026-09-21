/**
 * 改札が地上出口を兼ねる駅(改札＝出口)の保守的判定。
 *
 * 欠落した出口を成功扱いにしない。PR #133 Option A(gate-only 成功化)は
 * 不採用のまま。この判定は案内コピー専用であり、isScoringBothHit /
 * TripleHit(乗車 AND 改札 AND 出口の具体名)は出口名が無い限り不合格のまま。
 *
 * 都市名では分岐しない(徒歩分数と同じ)。到着路線・駅の路線一覧・改札名の
 * 形・収録出口数だけを見る。路線情報が空なら「地下鉄ではない」とはみなさない。
 */

export type GateExitRelation =
  | { kind: "separate_exit"; reason: string }
  | { kind: "gate_equals_exit"; reason: string }
  | { kind: "exit_unknown"; missing: "gate_and_exit" | "exit_only"; reason: string };

export interface GateExitRelationInput {
  gateNames: readonly string[];
  exitNames: readonly string[];
  /** 到着駅直前の乗車路線。空なら改札＝出口にしない。 */
  arrivalLine: string | null;
  /** 到着駅の事業者名。地下鉄判定の補助。HeartRails では空文字になりうる。 */
  arrivalOperator: string | null;
  /** 到着駅に紐づく路線一覧。Gemini の短縮路線名を補う。 */
  stationLines: readonly string[];
  /**
   * 収録カタログ等で分かっている独立した出口数。
   * null は未知(0 とはみなさない)。1 以上なら改札＝出口にしない。
   */
  knownSeparateExitCount: number | null;
}

export interface ExitPresentation {
  instruction: string;
  /** API / summary。gate_equals_exit では改札固有名を入れない。 */
  recommendedExit: string;
  keyExitPhrase: string;
  overviewPrimary: string;
  overviewSecondary?: string;
}

export const GATE_EQUALS_EXIT_LABEL = "この改札が出口です";
export const GATE_EQUALS_EXIT_INSTRUCTION = "この改札が出口です。改札を出ると地上です。";
export const EXIT_UNKNOWN_SOFT_INSTRUCTION =
  "出口名は確認できません。改札を出て目的地へ向かってください。";
export const EXIT_UNKNOWN_HARD_INSTRUCTION = "出口は確認できません。";
export const EXIT_UNKNOWN_SOFT_LABEL = "出口名は未確認";

const SUBWAY_HINT = /地下鉄|メトロ|Metro|都営|市営/i;
const UNDERGROUND = /地下/;
const FLOOR_OR_SURFACE = /[1-9]階|地上/;
const NAMED_EXIT_GATE = /口改札/;

export function looksLikeSubwayContext(
  line: string | null,
  operator: string | null,
  stationLines: readonly string[] = []
): boolean {
  return [line, operator, ...stationLines].some((part) => Boolean(part && SUBWAY_HINT.test(part)));
}

export function hasSurfaceGateCue(name: string): boolean {
  const normalized = name.normalize("NFKC");
  if (UNDERGROUND.test(normalized)) return false;
  return FLOOR_OR_SURFACE.test(normalized) || NAMED_EXIT_GATE.test(normalized);
}

function hasConfirmedSurfaceArrival(
  arrivalLine: string | null,
  arrivalOperator: string | null,
  stationLines: readonly string[]
): boolean {
  if (!arrivalLine || arrivalLine.trim().length === 0) return false;
  return !looksLikeSubwayContext(arrivalLine, arrivalOperator, stationLines);
}

export function classifyGateExitRelation(input: GateExitRelationInput): GateExitRelation {
  if (input.exitNames.length > 0) {
    return { kind: "separate_exit", reason: "独立した出口名がある" };
  }
  if (input.gateNames.length === 0) {
    return { kind: "exit_unknown", missing: "gate_and_exit", reason: "改札も出口も無い" };
  }
  if ((input.knownSeparateExitCount ?? 0) > 0) {
    return {
      kind: "exit_unknown",
      missing: "exit_only",
      reason: "収録に独立した出口があるので改札＝出口にしない",
    };
  }
  if (!hasConfirmedSurfaceArrival(input.arrivalLine, input.arrivalOperator, input.stationLines)) {
    return {
      kind: "exit_unknown",
      missing: "exit_only",
      reason: "到着路線が空か地下鉄文脈のため改札＝出口にしない",
    };
  }
  if (!input.gateNames.every(hasSurfaceGateCue)) {
    return {
      kind: "exit_unknown",
      missing: "exit_only",
      reason: "改札名に地上・階・口改札の合図が揃っていない",
    };
  }
  return {
    kind: "gate_equals_exit",
    reason: "地上改札の合図があり、独立出口も地下鉄文脈も無い",
  };
}

export function exitPresentationFor(
  relation: GateExitRelation,
  input: {
    exitNames: readonly string[];
    gateNames: readonly string[];
    exitIsAlternatives: boolean;
    directionLabel: string | null;
  }
): ExitPresentation {
  switch (relation.kind) {
    case "separate_exit":
      return {
        instruction: input.exitIsAlternatives
          ? `利用できる出口: ${input.exitNames.join(" / ")}(いずれか。現地の案内表示でご確認ください)。`
          : `${input.exitNames[0]}から出てください。`,
        recommendedExit: input.exitIsAlternatives
          ? `${input.exitNames.join(" / ")}(いずれか)`
          : (input.exitNames[0] ?? "確認できません"),
        keyExitPhrase: `${input.exitNames.join(" / ")}へ`,
        overviewPrimary: input.exitNames.join(" / "),
      };
    case "gate_equals_exit":
      return {
        instruction: GATE_EQUALS_EXIT_INSTRUCTION,
        recommendedExit: GATE_EQUALS_EXIT_LABEL,
        keyExitPhrase: GATE_EQUALS_EXIT_LABEL,
        overviewPrimary: input.gateNames[0] ?? GATE_EQUALS_EXIT_LABEL,
        overviewSecondary: GATE_EQUALS_EXIT_LABEL,
      };
    case "exit_unknown":
      if (relation.missing === "gate_and_exit") {
        return {
          instruction: EXIT_UNKNOWN_HARD_INSTRUCTION,
          recommendedExit: "確認できません",
          keyExitPhrase: input.directionLabel
            ? `出口は確認できません(推奨方向: ${input.directionLabel}側)`
            : "出口は確認できません",
          overviewPrimary: "確認できません",
          overviewSecondary: input.directionLabel
            ? `推奨方向: ${input.directionLabel}側`
            : undefined,
        };
      }
      return {
        instruction: EXIT_UNKNOWN_SOFT_INSTRUCTION,
        recommendedExit: EXIT_UNKNOWN_SOFT_LABEL,
        keyExitPhrase: "出口名は確認できません",
        overviewPrimary: EXIT_UNKNOWN_SOFT_LABEL,
        overviewSecondary: input.directionLabel
          ? `推奨方向: ${input.directionLabel}側`
          : undefined,
      };
    default: {
      const _exhaustive: never = relation;
      return _exhaustive;
    }
  }
}
