/**
 * La parte del sembrador que recuerda: el cerrojo por mazo y el contador de lo
 * que la casa ya puso en esta ronda (`pot_seed_runs`), más la consulta de si la
 * ronda que cerró ya consta liquidada (`round_settlements`).
 *
 * Vive aparte de `seed-floor.ts` por la misma razón que `seed-chain.ts`: el
 * robot se prueba con `node` y una base de datos de mentira.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeedDeps, LeaseRow, ReleasePatch } from "./seed-floor";

/** Las tres dependencias que salen de Supabase. */
export function dbDeps(
  db: SupabaseClient,
  now: () => number
): Pick<SeedDeps, "isSettled" | "claim" | "release"> {
  return {
    /**
     * ¿La ronda que cerró ya consta liquidada para este mazo?
     *
     * Ante un error de consulta se contesta `false` — o sea "todavía no" —, que
     * dentro de la ventana de cierre hace ESPERAR. Es el lado seguro: no se
     * siembra encima de un pago que puede estar en camino. Pasada la ventana el
     * robot siembra igual, así que un Supabase caído retrasa la siembra pero no
     * puede volver a matar el pozo.
     */
    async isSettled(roundDate, deck) {
      const { data, error } = await db
        .from("round_settlements")
        .select("deck_size")
        .eq("round_date", roundDate)
        .eq("deck_size", deck)
        .maybeSingle();
      if (error) return false;
      return Boolean(data);
    },

    /**
     * Toma el arriendo del mazo.
     *
     * Un solo UPDATE condicional: Postgres serializa las dos corridas que lo
     * intenten a la vez y solo una ve la fila afectada. La otra recibe `null` y
     * se va sin gastar ni una lectura de cadena.
     *
     * Lo que devuelve son los valores de ANTES del cambio en las dos columnas
     * que importan (`round_date`, `spent_units`), porque el UPDATE no las toca.
     */
    async claim(deck, leaseMs): Promise<LeaseRow | null> {
      const nowIso = new Date(now()).toISOString();
      const until = new Date(now() + leaseMs).toISOString();
      const { data, error } = await db
        .from("pot_seed_runs")
        .update({ locked_until: until, updated_at: nowIso })
        .eq("deck_size", deck)
        .lt("locked_until", nowIso)
        .select("round_date, spent_units")
        .maybeSingle();
      if (error || !data) return null;
      return {
        roundDate: String(data.round_date),
        spentUnits: BigInt(String(data.spent_units ?? "0")),
      };
    },

    /**
     * Suelta el arriendo anotando lo que pasó.
     *
     * `locked_until` vuelve a un instante YA PASADO, o sea libre de verdad: si
     * la siembra falló, la corrida siguiente puede reintentar sin esperar a que
     * venza nada. El segundo de margen no es cosmético — `claim` filtra por
     * `locked_until < now`, así que soltar poniendo exactamente `now` deja la
     * fila intomable mientras el reloj no avance. `verify-seed-lock.ts` lo
     * cazó contra Postgres: con un reloj fijo, soltar y volver a tomar fallaba.
     *
     * `last_tx_hash` y `last_error` solo se escriben cuando hay algo que decir,
     * para no borrar el rastro del último intento de verdad con un salto.
     */
    async release(deck, patch: ReleasePatch) {
      const nowIso = new Date(now()).toISOString();
      const row: Record<string, unknown> = {
        round_date: patch.roundDate,
        spent_units: patch.spentUnits.toString(),
        locked_until: new Date(now() - 1000).toISOString(),
        last_run_at: nowIso,
        updated_at: nowIso,
      };
      if (patch.txHash) {
        row.last_tx_hash = patch.txHash;
        row.last_error = null;
      }
      if (patch.error) row.last_error = patch.error;

      await db.from("pot_seed_runs").update(row).eq("deck_size", deck);
    },
  };
}
