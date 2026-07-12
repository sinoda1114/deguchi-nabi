import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/layout/AppHeader";
import { HomeStationForm } from "@/components/settings/HomeStationForm";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <h1 className="mb-1 text-lg font-black">ようこそ、でぐちなびへ</h1>
        <p className="mb-6 text-sm leading-relaxed text-[var(--foreground-muted)]">
          号車、乗換導線、改札、出口までを一続きで案内します。
          まずはよく使う最寄り駅を登録してください。
        </p>
        <HomeStationForm currentStation={null} redirectTo="/" />
      </main>
    </div>
  );
}
