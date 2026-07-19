/**
 * EVAL_STATION_LIMIT環境変数を検証し、評価対象の駅数を確定する。
 *
 * 未検証のまま`Number()`+`slice(0, limit)`すると、不正値
 * (数値でない文字列・0・負数)が`NaN`や`0`になり、`slice(0, NaN)`は
 * 空配列を返す。0駅で評価すると全ての合計が0のままexpectを通過してしまい、
 * 「評価をスキップしているのに合格した」ように見えてしまう
 * (/ai-review指摘、Medium)。ここで明示的に検証し、不正値は例外にする。
 */
export function resolveEvalStationLimit(
  raw: string | undefined,
  datasetLength: number
): number {
  if (raw === undefined) return datasetLength;

  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0 || limit > datasetLength) {
    throw new Error(
      `EVAL_STATION_LIMITが不正です: "${raw}"(1以上${datasetLength}以下の整数を指定してください)`
    );
  }
  return limit;
}
