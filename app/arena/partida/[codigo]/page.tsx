import type { Metadata } from "next";
import ArenaMatch from "@/components/arena/ArenaMatch";
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
    title: code ? t("meta.arena.match.title", { code }) : t("meta.arena.title"),
    robots: { index: false, follow: false },
  };
}

/**
 * /arena/partida/[codigo] — la partida en curso.
 *
 * Sin barra inferior: durante la partida no hay a dónde ir, y un botón de
 * "Perfil" al lado de la carta es una forma de perder. Se sale por el enlace de
 * abandonar, que además le da la victoria al otro en vez de dejarlo esperando.
 *
 * El `<main>` lo pinta `ArenaMatch` y no esta página, aunque sea un envoltorio
 * y los envoltorios suelan vivir aquí. El motivo es que sus clases dependen de
 * la fase —jugando el alto se clava al viewport y no hay scroll; al terminar
 * tiene que haberlo— y la fase solo la conoce el cliente. Con el `<main>` aquí,
 * el candado del tablero seguía puesto en la pantalla de resultados y no se
 * podía bajar a leerlos. Ver `matchShellClass`.
 */
export default async function ArenaMatchPage({ params }: Props) {
  const { codigo } = await params;
  const raw = decodeURIComponent(codigo);

  return <ArenaMatch code={normalizeRoomCode(raw) ?? raw} />;
}
