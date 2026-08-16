/**
 * Las dependencias del sembrador, montadas para producción.
 *
 * Existe para que la ruta del cron (`/api/cron/seed-pots`) y el cierre
 * (`/api/cron/roll-day`, que ahora encadena la siembra) usen EXACTAMENTE las
 * mismas: el mismo cerrojo, la misma regla y el mismo reloj. Dos composiciones
 * distintas serían dos comportamientos distintos, y el cerrojo solo sirve si
 * los dos caminos pasan por él.
 */

import { getSupabaseAdmin } from "./supabase/server";
import { chainDeps } from "./seed-chain";
import { dbDeps } from "./seed-db";
import type { SeedDeps } from "./seed-floor";

export function seedDeps(): SeedDeps {
  const now = () => Date.now();
  return { ...chainDeps(), ...dbDeps(getSupabaseAdmin(), now), now };
}
