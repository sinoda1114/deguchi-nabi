import { AppHeader } from "@/components/layout/AppHeader";
import { AuthForm } from "@/components/auth/AuthForm";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={null} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <h1 className="mb-1 text-lg font-black">ログイン・新規登録</h1>
        <p className="mb-6 text-sm text-[var(--foreground-muted)]">
          最寄り駅の保存や履歴・お気に入りを使うにはアカウントが必要です。
        </p>
        <AuthForm />
      </main>
    </div>
  );
}
