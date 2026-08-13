// Verifica el abandono real de una partida: quién gana cuándo, que nadie
// pueda abandonar en nombre de otro, que sea idempotente y que el que se fue
// no pueda seguir jugando.
//
// ── Qué es pura lógica y qué es cableado ──────────────────────────────────
//
// La REGLA de quién gana cuándo (`decideMatchOutcome`, en `arena-outcome.ts`)
// es una función pura, y este archivo la recorre entera con los ejemplos que
// pidió Juan: 2, 3 y 4 jugadores, y la cadena 4 → 3 → 2 → 1 de abandonos
// sucesivos.
//
// Lo que NO se puede probar sin una base de datos y un cliente HTTP de
// verdad —que un jugador ya idos NO pueda mover, que abandonar dos veces no
// duplique nada, que nadie pueda abandonar por otro, que la liquidación
// corra una sola vez— se verifica CONTRA EL CÓDIGO FUENTE: se lee el archivo
// real y se comprueba que el guardia que hace falta sigue ahí. Es la misma
// técnica que ya usan `verify-match-board-fit.ts` y `verify-match-over-scroll.ts`
// para invariantes de marcado; aquí es para invariantes de seguridad. Si
// alguien borra el guardia, esto se rompe con el archivo señalado, no con un
// mensaje genérico.
//
// Correr: node scripts/verify-arena-leave.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decideMatchOutcome, type SeatState } from "../lib/arena-outcome.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

function check(name: string, actual: unknown, expected: unknown) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `esperado ${JSON.stringify(expected)}, recibido ${JSON.stringify(actual)}`);
}

/* ── La regla, con los ejemplos exactos que se pidieron ──────────────────── */

const A = "profile-a";
const B = "profile-b";
const C = "profile-c";
const D = "profile-d";

const AHORA = 1_770_000_000_000;
const GRACIA = 90_000;

const silla = (id: string, o: Partial<SeatState> = {}): SeatState => ({
  id,
  cleared: false,
  left: false,
  lastSeenAt: AHORA,
  ...o,
});

const fin = (seats: SeatState[]) => decideMatchOutcome(seats, AHORA, GRACIA);

console.log("\n— 2 jugadores —");

check(
  "A abandona → B gana",
  fin([silla(A, { left: true }), silla(B)]),
  { kind: "settle", winner: B, reason: "abandoned" }
);

check(
  "B abandona → A gana",
  fin([silla(A), silla(B, { left: true })]),
  { kind: "settle", winner: A, reason: "abandoned" }
);

console.log("\n— 3 y 4 jugadores: solo se elimina a quien se va —");

check(
  "3 jugadores, A abandona → B y C siguen",
  fin([silla(A, { left: true }), silla(B), silla(C)]),
  { kind: "playing" }
);

check(
  "4 jugadores, A abandona → B, C y D siguen",
  fin([silla(A, { left: true }), silla(B), silla(C), silla(D)]),
  { kind: "playing" }
);

console.log("\n— 4 → 3 → 2 → 1 por abandonos sucesivos —");

{
  // Se abandona de a uno, y en cada paso se reconstruyen las CUATRO sillas
  // con el estado acumulado hasta ese momento — es lo mismo que leería
  // `closeIfAbandoned` de la base en cada lectura: no importa, y no debería,
  // en qué orden se fueron.
  const mesa = [A, B, C, D];
  const fueron = new Set<string>();

  const paso = (nombre: string, seVa: string, esperado: ReturnType<typeof fin>) => {
    fueron.add(seVa);
    const seats = mesa.map((id) => silla(id, { left: fueron.has(id) }));
    check(nombre, fin(seats), esperado);
  };

  paso("se va A → quedan B, C, D jugando", A, { kind: "playing" });
  paso("se va B → queda C, D jugando", B, { kind: "playing" });
  paso("se va C → gana D, el último de pie", C, {
    kind: "settle",
    winner: D,
    reason: "abandoned",
  });
}

console.log("\n— Idempotente: abandonar dos veces no cambia el resultado —");

{
  const primera = fin([silla(A, { left: true }), silla(B)]);
  // La segunda llamada representa el segundo toque del botón: el estado de
  // las sillas no cambió —A ya estaba `left`, `leaveMatch` no vuelve a
  // escribir nada porque su `update` va filtrado por `.is("left_at", null)`—
  // así que el veredicto tiene que ser exactamente el mismo, no una variante.
  const segunda = fin([silla(A, { left: true }), silla(B)]);
  check("mismo resultado las dos veces", segunda, primera);
}

/* ── Lo que exige leer el código: nadie abandona por otro, y sin duplicar ── */

console.log("\n— Quién puede abandonar, y por dónde pasa la ruta —");

{
  const leaveRoute = readFileSync(
    join(ROOT, "app/api/arena/matches/[code]/leave/route.ts"),
    "utf8"
  );

  ok(
    "la ruta resuelve el actor con la misma ficha de silla que `move`",
    /resolveActor\(req, code, "act"\)/.test(leaveRoute),
    "sin esto, cualquier sesión podría abandonar sin probar que es dueña de la silla"
  );

  ok(
    "el perfil que abandona sale SIEMPRE de la ficha resuelta, nunca del cuerpo de la request",
    /leaveMatch\(\{\s*code,\s*profileId:\s*resolved\.actor\.profileId\s*\}\)/.test(
      leaveRoute
    ),
    "si el profileId viniera del body, cualquiera podría abandonar en nombre de otro"
  );

  ok(
    "ya no hay un bloqueo total por mesa con premio",
    !/forfeitBlocked/.test(leaveRoute),
    "forfeitBlocked volvió a la ruta de la partida — eso es el 403 que no queríamos"
  );

  const roomLeaveRoute = readFileSync(
    join(ROOT, "app/api/arena/rooms/[code]/leave/route.ts"),
    "utf8"
  );
  ok(
    "el lobby (antes de repartir) SIGUE protegido — esto no cambió",
    /forfeitBlocked/.test(roomLeaveRoute),
    "levantarse del lobby de una mesa pagada sigue sin ser un botón — ver arena-guard.ts"
  );
}

console.log("\n— Idempotente también en la base: el `update` no re-escribe —");

{
  const src = readFileSync(
    join(ROOT, "lib/supabase/arena-matches.ts"),
    "utf8"
  );
  const leaveMatch = src.slice(
    src.indexOf("export async function leaveMatch"),
    src.indexOf("export async function leaveMatch") + 700
  );
  ok(
    'el UPDATE de `left_at` va filtrado por `.is("left_at", null)`',
    /\.is\("left_at",\s*null\)/.test(leaveMatch),
    "sin el filtro, tocar el botón dos veces pisaría el `left_at` de la primera vez"
  );

  ok(
    "`closeIfAbandoned` usa la MISMA función que decide 2/3/4 jugadores, no una copia",
    /decideMatchOutcome\(/.test(src),
    "si esto falla, alguien volvió a escribir la regla a mano en vez de reusar arena-outcome.ts"
  );
}

console.log("\n— El que se fue no puede seguir jugando —");

{
  for (const archivo of [
    "supabase/migrations/20260801000000_arena_matches.sql",
    "supabase/migrations/20260809000000_arena_duels.sql",
  ]) {
    const sql = readFileSync(join(ROOT, archivo), "utf8");
    ok(
      `    ${archivo}: \`arena_apply_move\` rechaza a quien tiene \`left_at\``,
      /left_at is not null[\s\S]{0,80}not_playing/.test(sql),
      "sin este guardia, el que abandonó podría seguir tocando cartas"
    );
  }
}

console.log("\n— La liquidación corre una sola vez —");

{
  const escrowMigration = readFileSync(
    join(ROOT, "supabase/migrations/20260808000000_arena_escrow.sql"),
    "utf8"
  );
  ok(
    "`arena_settlements.table_id` es único — el candado real",
    /table_id[\s\S]{0,60}unique/i.test(escrowMigration) ||
      /unique[\s\S]{0,200}table_id/i.test(escrowMigration),
    "sin el índice único, dos liquidaciones a la vez podrían pagar el pozo dos veces"
  );

  const hook = readFileSync(
    join(ROOT, "lib/supabase/arena-settle-hook.ts"),
    "utf8"
  );
  const claimIdx = hook.indexOf("claimSettlement(");
  const settleIdx = hook.indexOf("settleTable(");
  ok(
    "se reclama en la base ANTES de mandar la transacción, no después",
    claimIdx !== -1 && settleIdx !== -1 && claimIdx < settleIdx,
    `claimSettlement en ${claimIdx}, settleTable en ${settleIdx}`
  );
  ok(
    "si ya la reclamó otro, esta llamada se retira sin tocar la cadena",
    /claimed\.status !== "ok"\) return/.test(hook),
    "sin este corte, una carrera entre el cron y una lectura podría intentar pagar dos veces"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
