import type { Metadata } from "next";
import ArenaSoon from "@/components/arena/ArenaSoon";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import { parseEntry, parsePlayers } from "@/lib/arena";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("meta.arena.quick.title") };
}

interface Props {
  searchParams: Promise<{ entry?: string; players?: string }>;
}

/**
 * /arena/rapida — pantalla temporal de la partida rápida. Aquí vivirá el
 * emparejamiento: por ahora solo confirma la mesa elegida en el lobby.
 */
export default async function ArenaQuickPage({ searchParams }: Props) {
  const { entry, players } = await searchParams;

  return (
    <main className="app-shell profile-page page-stack">
      <ArenaSoon
        titleKey="arena.mode.quick.title"
        textKey="arena.soon.quick"
        entryUnits={parseEntry(entry)}
        players={parsePlayers(players)}
      />

      <ProfileBottomNav active="arena" />
    </main>
  );
}
