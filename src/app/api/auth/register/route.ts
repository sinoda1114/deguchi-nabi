import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/lib/store/user-repository";
import { createSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "有効なメールアドレスを入力してください" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上で入力してください" }, { status: 400 });
  }

  try {
    const user = createUser(email, password);
    await createSession(user.userId);
    return NextResponse.json({ user });
  } catch (err) {
    const message = err instanceof Error ? err.message : "登録に失敗しました";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
