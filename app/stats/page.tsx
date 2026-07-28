import type { Metadata } from "next";
import LiveStats from "@/components/stats/LiveStats";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t("meta.stats.title"),
    description: t("meta.stats.description"),
  };
}

/**
 * /stats — panel público de estadísticas en vivo. No pide sesión y no muestra
 * datos de ninguna persona en concreto: solo agregados del juego.
 */
export default async function StatsPage() {
  const t = await getServerT();

  return (
    <main className="app-shell profile-page">
      <h1 className="page-title">{t("stats.title")}</h1>
      <p className="page-lead">{t("stats.lead")}</p>

      <LiveStats />

      <ProfileBottomNav active="stats" />
    </main>
  );
}
