import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createFeedback } from "@/lib/store/feedback-repository";
import type { FeedbackCategory } from "@/lib/domain/feedback";

const VALID_CATEGORIES: FeedbackCategory[] = [
  "wrong_car",
  "wrong_gate",
  "wrong_exit",
  "wrong_facility",
  "passage_blocked",
  "better_route",
  "other",
];

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const routeGuideId = typeof body?.routeGuideId === "string" ? body.routeGuideId : "";
  const category = VALID_CATEGORIES.includes(body?.category) ? body.category : null;
  const targetEntity = typeof body?.targetEntity === "string" ? body.targetEntity : "";

  if (!routeGuideId || !category || !targetEntity) {
    return NextResponse.json({ error: "報告に必要な情報が不足しています" }, { status: 400 });
  }

  const feedback = createFeedback({
    userId: user.userId,
    routeGuideId,
    category,
    targetEntity,
    reportedValue: typeof body?.reportedValue === "string" ? body.reportedValue : null,
    suggestedValue: typeof body?.suggestedValue === "string" ? body.suggestedValue : null,
    comment: typeof body?.comment === "string" ? body.comment : null,
  });

  return NextResponse.json({ feedback });
}
