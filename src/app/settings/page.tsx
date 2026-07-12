import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { stationProvider } from "@/lib/integrations";
import { AppHeader } from "@/components/layout/AppHeader";
import { HomeStationForm } from "@/components/settings/HomeStationForm";
import { LogoutButton } from "@/components/auth/LogoutButton";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const homeStation = user.homeStationId
    ? await stationProvider.getStation(user.homeStationId)
    : null;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <h1 className="mb-1 text-lg font-black">アカウント設定</h1>
        <p className="mb-6 text-sm text-[var(--foreground-muted)]">{user.email}</p>

        <section className="mb-8">
          <h2 className="mb-2 text-xs font-bold text-[var(--foreground-muted)]">最寄り駅</h2>
          <HomeStationForm currentStation={homeStation} redirectTo="/settings" />
        </section>

        <LogoutButton />
      </main>
    </div>
  );
}
