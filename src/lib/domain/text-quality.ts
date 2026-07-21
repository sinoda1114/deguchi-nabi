const DEFAULT_MIN_SUBSTRING_LENGTH = 4;

/**
 * テキスト内に、LLMの縮退生成(degenerate repetition)を疑わせる
 * 内部反復パターンがあるかを判定する。
 *
 * 判定方法: 長さminSubstringLength以上の部分文字列が、テキスト内に2回以上出現する場合を
 * 反復ありとみなす。正当な地名・路線名がこの条件を満たす確率は極めて低い
 * (実例: 「瘉鉄改戳版最改版甘鉄改戳版最改版・瘉鉄改戳版最改版甘鉄改戳版最改版」は
 * 「鉄改戳版最改版」(7文字)が2回出現する)。
 */
export function hasRepetitionArtifact(
  text: string,
  minSubstringLength: number = DEFAULT_MIN_SUBSTRING_LENGTH
): boolean {
  if (text.length < minSubstringLength * 2) return false;

  for (let start = 0; start + minSubstringLength <= text.length; start++) {
    const substring = text.slice(start, start + minSubstringLength);
    const firstOccurrence = text.indexOf(substring);
    const secondOccurrence = text.indexOf(substring, firstOccurrence + 1);
    if (secondOccurrence !== -1) return true;
  }

  return false;
}
