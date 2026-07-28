import { cookies, headers } from "next/headers";
import {
  langFromAcceptLanguage,
  normalizeLang,
  translatorFor,
  LANG_COOKIE,
  type Lang,
  type Translate,
} from "./index";

/**
 * Idioma para renderizar en el servidor: primero la elección guardada del
 * jugador, y si no la hay, el idioma del dispositivo según `Accept-Language`.
 *
 * Leer cabeceras convierte las rutas en dinámicas, que es justo lo que hace
 * falta para que cada visitante reciba su idioma desde la primera pintura.
 */
export async function getServerLang(): Promise<Lang> {
  const chosen = normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
  if (chosen) return chosen;
  return langFromAcceptLanguage((await headers()).get("accept-language"));
}

/** Traductor listo para componentes de servidor y `generateMetadata`. */
export async function getServerT(): Promise<Translate> {
  return translatorFor(await getServerLang());
}
