import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isAdminUser } from "@/lib/auth/admin";
import { updateFeedbackStatus } from "@/lib/store/feedback-repository";
import type { FeedbackStatus } from "@/lib/domain/feedback";

const VALID_STATUSES: FeedbackStatus[] = [
  "received",
  "under_review",
  "verified",
  "rejected",
  "published",
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ feedbackId: string }> }
) {
  const user = await getSessionUser();
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!VALID_STATUSES.includes(body?.status)) {
    return NextResponse.json({ error: "不正なステータスです" }, { status: 400 });
  }

  const { feedbackId } = await params;
  const feedback = updateFeedbackStatus(feedbackId, body.status);
  if (!feedback) {
    return NextResponse.json({ error: "対象のフィードバックが見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ feedback });
}
