import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { seedToFloor, SEED_DECKS, type SeedDeps } from "@/lib/seed-floor";
import { chainDeps, isSeedConfigured } from "@/lib/seed-chain";
import { dbDeps } from "@/lib/seed-db";
import { FLOOR_UNITS, fmtUnits } from "@/lib/seed-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cuánto del presupuesto de la función se deja para sembrar. Pasado esto no se
 * empieza un mazo nuevo: se corta limpio y lo recoge la corrida siguiente, que
 * es gratis porque el trabajo es idempotente. Quedarse a medias por un timeout
 * de Vercel dejaría un cerrojo tomado hasta que venciera el arriendo.
 */
const BUDGET_MS = 45_000;

/**
 * GET /api/cron/seed-pots — lleva los tres pozos a su suelo (0,30 USDT).
 *
 * Es el trabajo que ANTES vivía al final de `/api/cron/roll-day` como
 * `seedPots([...txByDeck.keys()])`, o sea "resiembro los mazos que acabo de
 * pagar". La madrugada del 2026-08-16 esa siembra no salió y no había forma de
 * recuperarla: el respaldo de las 00:05 devolvía `already_settled` y desde el
 * día siguiente un pozo en cero ya ni entraba a liquidarse. Los tres pozos se
 * quedaron en 0,00 con el juego abierto. Ver `lib/seed-rules.ts`.
 *
 * Ahora es su propio trabajo, idempotente (`faltante = max(0, suelo − pozo)`),
 * con cerrojo por mazo y su propio reloj cada hora. Correrlo de más no cuesta
 * nada; correrlo de menos lo arregla la vuelta siguiente.
 *
 * Modos:
 *   (sin nada)  siembra lo que falte.
 *   ?probe=1    confirma URL y secreto sin leer cadena ni escribir nada.
 *   ?check=1    solo mira: ¿algún pozo por debajo del suelo? Es la ALARMA.
 *
 * Responde 500 cuando algo quedó mal, para que el fallo se vea en el cron de
 * Vercel y en GitHub Actions en vez de perderse en un 200 con malas noticias
 * dentro — que es exactamente como se perdió la siembra del 16.
 */
export async function GET(req: Request) {
  // Fail-closed: sin CRON_SECRET configurado, o con Bearer incorrecto, se
  // bloquea SIEMPRE. Nadie dispara siembras desde afuera.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;

  // Sondeo de salud: confirma que la URL responde y que el secreto coincide,
  // sin leer la cadena, sin firmar y sin escribir una sola fila.
  if (params.get("probe") === "1") {
    return NextResponse.json({
      ok: true,
      probe: true,
      configured: isSeedConfigured(),
      now: new Date().toISOString(),
    });
  }

  if (!isSeedConfigured()) {
    return NextResponse.json(
      { error: "seed_not_configured" },
      { status: 503 }
    );
  }

  const chain = chainDeps();

  // Modo alarma: solo lee los pozos y dice si alguno está por debajo del suelo.
  // No toca el cerrojo, no firma y no cuesta gas.
  if (params.get("check") === "1") {
    try {
      const pots = await Promise.all(SEED_DECKS.map((d) => chain.readPot(d)));
      const decks = SEED_DECKS.map((deck, i) => ({
        deck,
        pot: fmtUnits(pots[i]),
        belowFloor: pots[i] < FLOOR_UNITS,
      }));
      const alarm = decks.some((d) => d.belowFloor);
      if (alarm) {
        console.error(
          "[seed-pots] ALARMA · pozos por debajo del suelo: " +
            decks
              .filter((d) => d.belowFloor)
              .map((d) => `mazo ${d.deck} = ${d.pot}`)
              .join(", ")
        );
      }
      return NextResponse.json(
        { check: true, floor: fmtUnits(FLOOR_UNITS), decks, alarm },
        { status: alarm ? 500 : 200 }
      );
    } catch (e) {
      console.error("[seed-pots] no se pudieron leer los pozos:", e);
      return NextResponse.json({ error: "pot_read_failed" }, { status: 500 });
    }
  }

  const started = Date.now();
  const deps: SeedDeps = {
    ...chain,
    ...dbDeps(getSupabaseAdmin(), () => Date.now()),
    now: () => Date.now(),
  };

  const report = await seedToFloor(deps, SEED_DECKS, {
    deadlineMs: started + BUDGET_MS,
  });

  // El log es lo único que queda si nadie mira la respuesta. Que se distinga
  // de un vistazo entre "todo en orden" y "hay que mirar esto".
  for (const line of report.lines) console.log(`[seed-pots] ${line}`);
  if (report.alarm) {
    console.error(
      `[seed-pots] ALARMA · ronda ${report.round} · ${report.lines.join(" | ")}`
    );
  }

  return NextResponse.json(
    {
      round: report.round,
      funder: report.funder,
      funderBalance: report.funderBalance,
      floor: fmtUnits(FLOOR_UNITS),
      decks: report.decks,
      alarm: report.alarm,
      elapsedMs: Date.now() - started,
    },
    { status: report.alarm ? 500 : 200 }
  );
}
