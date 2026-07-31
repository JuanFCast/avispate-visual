import type { Metadata } from "next";
import ArenaLobby from "@/components/arena/ArenaLobby";
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
 * /arena — el lobby del modo multijugador: se elige cómo entrar (rápida o
 * privada), con cuánto y contra cuántos, y se ve el premio antes de decidir.
 *
 * Todavía no hay emparejamiento, ni salas, ni cobro, ni contrato: el botón
 * lleva a la pantalla del modo. Por eso tampoco pide sesión. El reto diario y
 * su lógica viven aparte y no se tocan desde aquí.
 */
export default function ArenaPage() {
  return (
    <main className="app-shell profile-page page-stack">
      <ArenaLobby />

      <ProfileBottomNav active="arena" />
    </main>
  );
}
