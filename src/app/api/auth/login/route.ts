import { NextRequest, NextResponse } from "next/server";
import { verifyUser } from "@/lib/store/user-repository";
import { createSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const user = verifyUser(email, password);
  if (!user) {
    return NextResponse.json(
      { error: "メールアドレスまたはパスワードが正しくありません" },
      { status: 401 }
    );
  }

  await createSession(user.userId);
  return NextResponse.json({ user });
}
