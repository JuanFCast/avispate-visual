import type { Metadata } from "next";
import ArenaCreate from "@/components/arena/ArenaCreate";
import ProfileBottomNav from "@/components/profile/ProfileBottomNav";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("meta.arena.create.title") };
}

/**
 * /arena/crear — la única pantalla de configuración del recorrido.
 *
 * No recibe nada por la URL, a diferencia de la de antes: no hay una elección
 * previa que arrastrar, porque en la primera pantalla ya no se configura nada.
 * Lo que se decide aquí se decide aquí, y el servidor lo vuelve a validar al
 * crear la sala.
 */
export default function ArenaCreatePage() {
  return (
    <main className="app-shell profile-page page-stack">
      <ArenaCreate />

      <ProfileBottomNav active="arena" />
    </main>
  );
}
