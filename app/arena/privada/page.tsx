import { redirect } from "next/navigation";

/**
 * /arena/privada — se partió en dos.
 *
 * Esta pantalla preguntaba "¿crear o unirse?" DESPUÉS de que /arena ya hubiera
 * preguntado lo mismo, y configuraba una sala que se descartaba si al final
 * entrabas con un código ajeno. Ahora esa decisión se toma una sola vez, en
 * /arena, y cada camino tiene su pantalla: /arena/crear y /arena/codigo.
 *
 * La ruta se queda como redirección porque su enlace vive en pestañas abiertas,
 * en el historial de los teléfonos y en el "volver" de partidas ya jugadas. Un
 * 404 ahí sería un error nuestro cobrado al jugador.
 */
export default function ArenaPrivateLegacyPage() {
  redirect("/arena");
}
