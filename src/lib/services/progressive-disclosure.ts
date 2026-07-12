/**
 * ヒックの法則(選択肢が増えるほど意思決定に時間がかかる)を踏まえ、
 * 一覧を「最初に見せる少数(primary)」と「折りたたんで隠す残り(more)」に分割する。
 * 呼び出し側は primary をそのまま表示し、more は「もっと見る」ボタン等で展開する想定。
 */
export function splitForDisclosure<T>(
  items: readonly T[],
  primaryCount: number
): { primary: T[]; more: T[] } {
  const count = Math.max(0, primaryCount);
  return {
    primary: items.slice(0, count),
    more: items.slice(count),
  };
}
