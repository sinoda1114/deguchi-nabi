/**
 * 号車 reason が、選んだ改札を指しているか／他改札を指していないか。
 * カタログ名の完全一致だけだと「道玄坂方面」などが落ちる。
 */
export function gateNameStem(gateName: string): string {
  return gateName.trim().replace(/(改札|口)$/u, "").trim();
}

export function reasonCitesGate(reason: string, gateName: string): boolean {
  const name = gateName.trim();
  if (name.length === 0) return false;
  if (reason.includes(name)) return true;
  const stem = gateNameStem(name);
  return stem.length >= 2 && reason.includes(stem);
}

/**
 * 他改札だけを理由にしている号車は捨てる。選んだ改札への言及は必須にしない
 * （同一検索セッションの号車は目的地込みで決まっている）。
 */
export function boardingAgreesWithChosenGate(
  reason: string,
  chosenGateName: string,
  siblingGateNames: readonly string[]
): boolean {
  const citesChosen = reasonCitesGate(reason, chosenGateName);
  for (const sibling of siblingGateNames) {
    if (sibling === chosenGateName) continue;
    if (reasonCitesGate(reason, sibling) && !citesChosen) return false;
  }
  return true;
}

/**
 * 共有 .first 号車をカタログ改札に載せてよいか。
 * Gemini が別改札を断定しているのに reason が選んだ改札を指さないなら捨てる。
 */
export function sharedBoardingFitsChosenGate(input: {
  reason: string;
  chosenGateName: string;
  siblingGateNames: readonly string[];
  firstFacilityGateName: string | null;
}): boolean {
  if (
    input.firstFacilityGateName &&
    input.firstFacilityGateName !== input.chosenGateName &&
    !reasonCitesGate(input.reason, input.chosenGateName)
  ) {
    return false;
  }
  return boardingAgreesWithChosenGate(
    input.reason,
    input.chosenGateName,
    input.siblingGateNames
  );
}
