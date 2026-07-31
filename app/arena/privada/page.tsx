import type { Metadata } from "next";
import ArenaSoon from "@/components/arena/ArenaSoon";
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
 * /arena/privada — pantalla temporal de la sala privada. Aquí vivirán crear la
 * sala y entrar con código: por ahora solo confirma la mesa elegida en el lobby.
 */
export default async function ArenaPrivatePage({ searchParams }: Props) {
  const { entry, players } = await searchParams;

  return (
    <main className="app-shell profile-page page-stack">
      <ArenaSoon
        titleKey="arena.mode.private.title"
        textKey="arena.soon.private"
        entryUnits={parseEntry(entry)}
        players={parsePlayers(players)}
      />

      <ProfileBottomNav active="arena" />
    </main>
  );
}
