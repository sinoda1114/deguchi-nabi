import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isAdminUser } from "@/lib/auth/admin";
import { listFeedback } from "@/lib/store/feedback-repository";
import type { FeedbackStatus } from "@/lib/domain/feedback";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get("status") as FeedbackStatus | null;
  return NextResponse.json({ feedback: listFeedback(status ?? undefined) });
}
