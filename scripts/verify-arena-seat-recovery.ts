// La ficha de silla que vence A MITAD DE PARTIDA.
//
// Dura dos horas desde el pago. Si alguien paga al poco de crearse la sala y la
// mesa tarda casi dos horas en llenarse, la partida empieza con la ficha a punto
// de vencer — y al vencer, cada movimiento se rechaza con `seat_token_required`.
// Quien no puede mover pierde por abandono: entrega el pozo por un reloj.
//
// No hace falta pagar ni firmar nada para arreglarlo. El secreto lleva en el
// dispositivo desde antes del pago y `/api/arena/seat` lo cambia por una ficha
// nueva. Lo que faltaba era pedirla, y pedirla UNA vez.
//
// Correr: node scripts/verify-arena-seat-recovery.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  isSeatTokenProblem,
  withSeatRecovery,
} from "../lib/arena-seat-recovery.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

/**
 * Un servidor de mentira con una ficha que vence.
 *
 * `tokenVálido` es lo que el servidor acepta ahora mismo; el cliente manda
 * `fichaActual`. Cuando no coinciden, contesta 403 `seat_token_required`, que
 * es exactamente lo que hace `guardRoomSeat` con una ficha vencida.
 */
function servidor(opts: {
  /** Qué ficha acepta el servidor. */
  aceptada: string;
  /** Con qué ficha arranca el cliente. */
  inicial: string;
  /** Qué devuelve el canje. `null` = no se pudo. */
  emite: string | null;
}) {
  let ficha = opts.inicial;
  const log = { envíos: 0, canjes: 0, fichas: [] as string[] };

  return {
    log,
    deps: {
      send: async () => {
        log.envíos++;
        log.fichas.push(ficha);
        if (ficha !== opts.aceptada) {
          return {
            status: 403,
            error: "seat_token_required",
            value: null as { jugada: string } | null,
          };
        }
        return { status: 200, error: undefined, value: { jugada: "ok" } };
      },
      claim: async () => {
        log.canjes++;
        return opts.emite;
      },
      remember: (t: string) => {
        ficha = t;
      },
    },
  };
}

console.log("\n— Qué se cura con una ficha nueva y qué no —");
{
  check("falta la ficha", isSeatTokenProblem(403, "seat_token_required"), true);
  check(
    "la ficha es de otra mesa",
    isSeatTokenProblem(403, "seat_token_wrong_table"),
    true
  );
  // Este NO: la cadena no reconoce a esa dirección como pagadora, y una ficha
  // nueva se emitiría igual para volver a chocar en la misma puerta.
  check(
    "esa dirección no pagó → no se pide ficha",
    isSeatTokenProblem(403, "seat_not_paid"),
    false
  );
  check("un 409 no es cosa de la ficha", isSeatTokenProblem(409, "seat_taken"), false);
  check("un 500 tampoco", isSeatTokenProblem(500, "server_error"), false);
  check("ni un 403 sin motivo", isSeatTokenProblem(403, undefined), false);
}

console.log("\n— La ficha vence a mitad de partida y el toque sale igual —");
{
  const s = servidor({ aceptada: "nueva", inicial: "vencida", emite: "nueva" });
  const r = await withSeatRecovery(s.deps);

  check("el movimiento acaba entrando", r.status, 200);
  check("y trae su resultado", r.value, { jugada: "ok" });
  check("hubo rescate", r.recovered, true);
  check("se canjeó una sola vez", s.log.canjes, 1);
  check("y se mandó dos veces, no más", s.log.envíos, 2);
  check(
    "el segundo envío llevó la ficha NUEVA",
    s.log.fichas,
    ["vencida", "nueva"]
  );
}

console.log("\n— Sin problema de ficha no se toca nada —");
{
  const s = servidor({ aceptada: "buena", inicial: "buena", emite: "otra" });
  const r = await withSeatRecovery(s.deps);

  check("entra a la primera", r.status, 200);
  check("no se pidió ficha", s.log.canjes, 0);
  check("un solo envío", s.log.envíos, 1);
  check("y no consta rescate", r.recovered, false);
}

console.log("\n— Y NUNCA gira: el reintento es uno —");
{
  // El caso feo: la ficha nueva tampoco sirve. Sin el tope, cada rechazo
  // pediría otra ficha y volvería a enviar, para siempre, dentro del bucle de
  // juego y con el teléfono al rojo.
  const s = servidor({ aceptada: "jamás", inicial: "vencida", emite: "nueva" });
  const r = await withSeatRecovery(s.deps);

  check("se rinde con el rechazo de verdad", r.status, 403);
  check("un solo canje", s.log.canjes, 1);
  check("dos envíos y se acabó", s.log.envíos, 2);
}

console.log("\n— Si no hay con qué rescatar, se dice y ya —");
{
  // Secreto borrado, mesa gratis o wallet desconectada: `claim` devuelve null.
  const s = servidor({ aceptada: "nueva", inicial: "vencida", emite: null });
  const r = await withSeatRecovery(s.deps);

  check("devuelve el rechazo original", r.status, 403);
  check("con su motivo, sin disfrazarlo", r.error, "seat_token_required");
  check("se intentó el canje", s.log.canjes, 1);
  check("y NO se reenvió a ciegas", s.log.envíos, 1);
}

console.log("\n— Enchufado en la pantalla donde se juega el dinero —");
{
  const cliente = readFileSync(join(ROOT, "lib/arena-match-client.ts"), "utf8");

  check(
    "el toque pasa por la recuperación",
    /const attempt = await withSeatRecovery\(\{/.test(cliente),
    true
  );
  check(
    "la ficha nueva se guarda antes del reintento",
    /remember: \(token\) => rememberSeatToken\(code, token\)/.test(cliente),
    true
  );
  check(
    "y el secreto se busca por la mesa que manda el servidor",
    /seatSecretFor\(tableId\)/.test(cliente),
    true
  );

  // El servidor tiene que mandar `tableId` en la partida: sin él, el cliente no
  // sabe qué secreto buscar y el rescate no existe.
  const matches = readFileSync(
    join(ROOT, "lib/supabase/arena-matches.ts"),
    "utf8"
  );
  check(
    "la partida manda su mesa",
    /tableId: terms\.tableId,/.test(matches),
    true
  );
  check(
    "y `null` cuando es gratis",
    /tableId: null,/.test(matches),
    true
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
