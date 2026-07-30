import type { Metadata } from "next";
import Link from "next/link";
import ArenaEntries from "@/components/arena/ArenaEntries";
import ArenaPlayers from "@/components/arena/ArenaPlayers";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t("meta.arena.title"),
    description: t("meta.arena.description"),
  };
}

/**
 * /arena — bienvenida del modo multijugador. Es una pantalla de "lo que viene":
 * no hay emparejamiento, ni pagos, ni partidas, y por eso tampoco pide sesión.
 * El reto diario y su lógica viven aparte y no se tocan desde aquí.
 */
export default async function ArenaPage() {
  const t = await getServerT();

  return (
    <main className="app-shell profile-page page-stack">
      <h1 className="page-title">{t("arena.title")}</h1>
      <p className="page-lead">{t("arena.support")}</p>

      <section className="arena-card arena-hero" aria-label={t("arena.aria")}>
        <span className="arena-tag">{t("arena.tag")}</span>

        <div className="arena-art">
          <ArenaPlayers />
        </div>

        <h2 className="arena-hero-title">{t("arena.soon.title")}</h2>
        <p className="arena-hero-text">{t("arena.soon.text")}</p>

        <ArenaEntries label={t("arena.soon.entries")} />

        <Link className="lobby-ranking-link" href="/">
          {t("arena.soon.back")}
        </Link>
      </section>

      <ProfileBottomNav active="arena" />
    </main>
  );
}
