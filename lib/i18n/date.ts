/**
 * Fechas de ronda para la interfaz. Viven aquí y no en cada pantalla porque el
 * historial y el perfil escriben la MISMA fecha y no pueden discrepar.
 */

import type { Lang } from "./index";

const MONTHS: Record<Lang, string[]> = {
  en: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
       "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
  es: ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
       "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"],
};

/**
 * "25 JUL 2026" a partir del texto YYYY-MM-DD, sin pasar por `Date`: la fecha
 * de la ronda es la de Colombia y no debe correrse a la zona del visitante.
 */
export function fmtRoundDate(roundDate: string, lang: Lang): string {
  const [year, month, day] = roundDate.split("-");
  return `${Number(day)} ${MONTHS[lang][Number(month) - 1] ?? ""} ${year}`;
}
