import type { RouteSegment } from "@/lib/domain/route";
import type { FacilitiesSearchResult } from "@/lib/services/route-search";
import { computeKeyInstruction } from "@/lib/services/route-search";

interface KeyInstructionTextProps {
  trainSegmentsPromise: Promise<RouteSegment[]>;
  facilitiesPromise: Promise<FacilitiesSearchResult>;
}

/**
 * KeyInstructionCard の見出し文言部分に埋め込む。
 * 号車情報(train)と改札・出口情報(facilities)の両方が揃って初めて
 * 意味のある案内文になるため、Promise.all で両方を待つ。
 */
export async function KeyInstructionText({
  trainSegmentsPromise,
  facilitiesPromise,
}: KeyInstructionTextProps) {
  const [trainSegments, facilitiesResult] = await Promise.all([
    trainSegmentsPromise,
    facilitiesPromise,
  ]);

  if (!facilitiesResult.ok) {
    return <>{facilitiesResult.reason}</>;
  }

  const keyInstruction = computeKeyInstruction(trainSegments, facilitiesResult.result);

  return <>{keyInstruction.text}</>;
}
