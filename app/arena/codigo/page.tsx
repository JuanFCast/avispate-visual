import type { Metadata } from "next";
import ArenaJoin from "@/components/arena/ArenaJoin";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("meta.arena.join.title") };
}

/**
 * /arena/codigo — entrar con el código de un amigo.
 *
 * Un campo y nada más. La configuración de la sala la puso el anfitrión y se
 * lee en la sala, no aquí: preguntarla en esta pantalla sería preguntar algo
 * que vamos a ignorar.
 */
export default function ArenaJoinPage() {
  return (
    <main className="app-shell profile-page page-stack">
      <ArenaJoin />

      <ProfileBottomNav active="arena" />
    </main>
  );
}
