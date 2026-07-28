import type { Metadata } from "next";
import Link from "next/link";
import WinnersHistory from "@/components/history/WinnersHistory";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t("meta.history.title"),
    description: t("meta.history.description"),
  };
}

/**
 * /historial — ganadores de las rondas ya cerradas. Es público: se consulta
 * sin iniciar sesión. No es el registro de partidas del jugador (eso vive en
 * /perfil) ni el ranking del día (eso vive en /ranking).
 */
export default async function HistorialPage() {
  const t = await getServerT();

  return (
    <main className="app-shell profile-page page-stack">
      <h1 className="page-title">{t("history.title")}</h1>
      <p className="page-lead">
        {t("history.lead")}{" "}
        <Link href="/ranking">{t("history.link.ranking")}</Link> ·{" "}
        <Link href="/stats">{t("common.live_stats")}</Link>
      </p>

      <WinnersHistory />

      <ProfileBottomNav active="historial" />
    </main>
  );
}
