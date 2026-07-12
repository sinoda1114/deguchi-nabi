export type ConfidenceLevel = "high" | "medium" | "low" | "unavailable";

export interface Confidence {
  level: ConfidenceLevel;
  reasons: string[];
  verifiedAt: string | null;
  expiresAt: string | null;
  sourceCount: number;
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "高",
  medium: "中",
  low: "低",
  unavailable: "確認不能",
};

export function unavailableConfidence(reason: string): Confidence {
  return {
    level: "unavailable",
    reasons: [reason],
    verifiedAt: null,
    expiresAt: null,
    sourceCount: 0,
  };
}
