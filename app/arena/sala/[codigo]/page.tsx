import type { Metadata } from "next";
import ArenaRoom from "@/components/arena/ArenaRoom";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import { normalizeRoomCode } from "@/lib/arena-rooms";
import { getServerT } from "@/lib/i18n/server";

interface Props {
  params: Promise<{ codigo: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { codigo } = await params;
  const t = await getServerT();
  const code = normalizeRoomCode(decodeURIComponent(codigo));
  return {
    title: code ? t("meta.arena.room.title", { code }) : t("meta.arena.title"),
    // Un código de sala en un índice de búsqueda deja de ser privado.
    robots: { index: false, follow: false },
  };
}

/**
 * /arena/sala/[codigo] — la mesa privada mientras se llena.
 *
 * La URL es lo que se comparte, así que abrirla tiene que bastar: quien ya está
 * sentado vuelve a su silla al recargar, y quien llega de un chat ve la mesa y
 * decide si entra. El código llega crudo de la URL —puede venir en minúsculas o
 * sin guion— y quien lo interpreta es siempre `normalizeRoomCode`; si no es un
 * código, la pantalla lo dice en vez de dejar la sala cargando para siempre.
 */
export default async function ArenaRoomPage({ params }: Props) {
  const { codigo } = await params;
  const raw = decodeURIComponent(codigo);

  return (
    <main className="app-shell profile-page page-stack">
      <ArenaRoom code={normalizeRoomCode(raw) ?? raw} />

      <ProfileBottomNav active="arena" />
    </main>
  );
}
