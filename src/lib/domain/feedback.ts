export type FeedbackCategory =
  | "wrong_car"
  | "wrong_gate"
  | "wrong_exit"
  | "wrong_facility"
  | "passage_blocked"
  | "better_route"
  | "other";

export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  wrong_car: "号車が違う",
  wrong_gate: "改札が違う",
  wrong_exit: "出口が違う",
  wrong_facility: "階段・エスカレーター・エレベーター情報が違う",
  passage_blocked: "通路が工事中または通行できない",
  better_route: "より良いルートがある",
  other: "その他",
};

export type FeedbackStatus =
  | "received"
  | "under_review"
  | "verified"
  | "rejected"
  | "published";

export interface Feedback {
  feedbackId: string;
  userId: string;
  routeGuideId: string;
  category: FeedbackCategory;
  targetEntity: string;
  reportedValue: string | null;
  suggestedValue: string | null;
  comment: string | null;
  status: FeedbackStatus;
  createdAt: string;
}
