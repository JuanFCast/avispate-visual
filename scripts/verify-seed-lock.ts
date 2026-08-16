// El cerrojo del sembrador, contra la base de datos DE VERDAD.
//
// `verify-seed-floor.ts` prueba el robot entero con un cerrojo de mentira, y
// eso deja sin comprobar justo lo que el encargo pide "evitar absolutamente":
// que dos corridas solapadas siembren dos veces. Esa garantía no vive en
// TypeScript, vive en el `update ... where locked_until < now()` de Postgres, y
// solo se puede comprobar contra Postgres.
//
// Usa un mazo de mentira (99) que se crea y se borra en el `finally`, así que
// no toca las filas de los mazos reales.
//
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local, y
// que la migración 20260816000000_pot_seed_runs.sql ya esté aplicada.
//
// Correr: node scripts/verify-seed-lock.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { dbDeps } from "../lib/seed-db.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DECK = 99;
const RONDA = "2026-08-17";

function envValue(key: string): string | null {
  const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.log(
    "❌ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local"
  );
  process.exitCode = 1;
}

const db = createClient(url ?? "", key ?? "", {
  auth: { persistSession: false },
});

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FALLA"} ${name}` +
      (ok
        ? ""
        : `\n         esperado ${JSON.stringify(expected)}` +
          `\n         recibido ${JSON.stringify(actual)}`)
  );
}

// Reloj de mentira, para poder saltar por encima del arriendo sin esperar.
let ahora = Date.now();
const deps = dbDeps(db, () => ahora);

/**
 * Todo dentro de una función para poder DEVOLVER el código de salida en vez de
 * llamar a `process.exit`: con el cliente de Supabase todavía vivo, salir a la
 * fuerza revienta libuv en Windows con un `Assertion failed` que tapa el
 * informe justo cuando más falta hace leerlo.
 */
async function main(): Promise<number> {
  // La tabla tiene que existir antes de nada: sin ella el robot no arranca.
  const probe = await db.from("pot_seed_runs").select("deck_size").limit(1);
  if (probe.error) {
    console.log(
      `\n❌ No se pudo leer pot_seed_runs: ${probe.error.message}\n` +
        "   ¿Corriste supabase/migrations/20260816000000_pot_seed_runs.sql\n" +
        "   en Supabase → SQL Editor?\n"
    );
    return 2;
  }

  try {
    await db.from("pot_seed_runs").delete().eq("deck_size", DECK);
    await db.from("pot_seed_runs").insert({
      deck_size: DECK,
      round_date: RONDA,
      spent_units: "0",
      locked_until: new Date(ahora - 1000).toISOString(),
    });

    console.log("\n— Tomar el cerrojo y leer lo que había —");
    {
      const row = await deps.claim(DECK, 120_000);
      check("se lleva la fila", row !== null, true);
      check("con su ronda", row?.roundDate, RONDA);
      check("y su gasto convertido a bigint", String(row?.spentUnits), "0");
    }

    console.log("\n— La segunda corrida NO se lo lleva —");
    {
      // Este es el caso del encargo: dos disparadores entrando a la vez. Sin
      // esto los dos leerían el pozo en 0,00 y los dos sembrarían 0,30.
      check("se va con las manos vacías", await deps.claim(DECK, 120_000), null);
    }

    console.log("\n— Al soltarlo, la siguiente sí entra —");
    {
      await deps.release(DECK, {
        roundDate: RONDA,
        spentUnits: 300_000n,
        txHash: "0xabc",
      });
      const row = await deps.claim(DECK, 120_000);
      check("entra", row !== null, true);
      check("y ve el gasto ya anotado", String(row?.spentUnits), "300000");
      await deps.release(DECK, { roundDate: RONDA, spentUnits: 300_000n });
    }

    console.log("\n— El arriendo vence solo —");
    {
      await deps.claim(DECK, 120_000);
      check("tomado", await deps.claim(DECK, 120_000), null);
      ahora += 121_000; // el reloj de mentira salta por encima del arriendo
      check("vencido, se puede retomar", (await deps.claim(DECK, 120_000)) !== null, true);
      await deps.release(DECK, { roundDate: RONDA, spentUnits: 300_000n });
    }

    console.log("\n— Dos corridas A LA VEZ: exactamente una gana —");
    {
      // Lo de arriba es secuencial y solo demuestra la lógica. Esto es la
      // carrera de verdad: tres UPDATE condicionales saliendo juntos contra la
      // misma fila. Quien los serializa es Postgres, no nosotros.
      for (let vuelta = 1; vuelta <= 3; vuelta++) {
        await db
          .from("pot_seed_runs")
          .update({ locked_until: new Date(ahora - 1000).toISOString() })
          .eq("deck_size", DECK);

        const carrera = await Promise.all([
          deps.claim(DECK, 120_000),
          deps.claim(DECK, 120_000),
          deps.claim(DECK, 120_000),
        ]);
        check(
          `vuelta ${vuelta}: un solo ganador de tres`,
          carrera.filter((r) => r !== null).length,
          1
        );
      }
    }

    console.log("\n— Lo que queda anotado para la alarma y el diagnóstico —");
    {
      await deps.release(DECK, {
        roundDate: RONDA,
        spentUnits: 600_000n,
        error: "nonce too low",
      });
      const { data } = await db
        .from("pot_seed_runs")
        .select("round_date, spent_units, last_tx_hash, last_error")
        .eq("deck_size", DECK)
        .single();
      check("la ronda", data?.round_date, RONDA);
      check("el gasto", String(data?.spent_units), "600000");
      check("el error del último intento", data?.last_error, "nonce too low");
      // Un fallo NO borra el hash del intento que sí salió: hace falta para
      // saber cuándo entró dinero por última vez.
      check("y el hash anterior sigue ahí", data?.last_tx_hash, "0xabc");
    }
  } finally {
    await db.from("pot_seed_runs").delete().eq("deck_size", DECK);
    const { data } = await db
      .from("pot_seed_runs")
      .select("deck_size")
      .eq("deck_size", DECK);
    if ((data ?? []).length > 0) {
      console.log(" FALLA no se pudo borrar la fila de prueba (mazo 99)");
      failed++;
    }
  }

  console.log(
    failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
  );
  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
