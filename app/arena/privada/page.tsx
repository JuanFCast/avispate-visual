import type { Metadata } from "next";
import ArenaPrivate from "@/components/arena/ArenaPrivate";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import { parseEntry, parsePlayers } from "@/lib/arena";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("meta.arena.private.title") };
}

interface Props {
  searchParams: Promise<{ entry?: string; players?: string }>;
}

/**
 * /arena/privada — crear una sala o entrar con el código de un amigo.
 *
 * La mesa (entrada y jugadores) llega del lobby por la URL y se vuelve a
 * validar aquí: quien manipule el enlace se lleva la configuración por defecto,
 * no una mesa inventada. Sigue sin haber cobro, contrato ni partida.
 */
export default async function ArenaPrivatePage({ searchParams }: Props) {
  const { entry, players } = await searchParams;

  return (
    <main className="app-shell profile-page page-stack">
      <ArenaPrivate
        entry={parseEntry(entry).toString()}
        players={parsePlayers(players)}
      />

      <ProfileBottomNav active="arena" />
    </main>
  );
}
