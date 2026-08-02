import { redirect } from "next/navigation";

/**
 * /arena/rapida — la partida rápida se retira hasta que exista.
 *
 * Esta pantalla no emparejaba a nadie: dejaba elegir entrada y jugadores y
 * terminaba en un cartel explicando que todavía no había mesa. Era un camino
 * ofrecido en la primera pantalla que no llevaba a jugar, y el jugador solo se
 * enteraba al final del recorrido.
 *
 * Vuelve cuando haya emparejamiento de verdad, con su cola en el servidor y su
 * estado de "buscando jugadores" en la sala. Mientras tanto la ruta redirige en
 * vez de desaparecer, por los enlaces que ya andan sueltos.
 */
export default function ArenaQuickLegacyPage() {
  redirect("/arena");
}
