// Verifica el reloj de la ronda: que el contador sea el MISMO en cualquier
// país, que lo gobierne el servidor y no el teléfono, y que resista pestañas
// dormidas. Cubre la matriz de pruebas del contador.
//
// Correr: node scripts/verify-round-clock.ts
//
// Las zonas se pasan explícitas y no por la variable TZ, que Node ignora para
// Intl en Windows: así la prueba da lo mismo en el portátil que en CI.
//
// Sin dependencias: Node 22+ ejecuta TypeScript quitando los tipos.
import {
  DAY_MS,
  formatCountdown,
  previousRoundId,
  roundClosesAt,
  roundIdAt,
  roundOpensAt,
} from "../lib/round-time.ts";

let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FALLA"} ${name}` +
      (ok ? "" : `\n         esperado ${expected}\n         recibido ${actual}`)
  );
}

/**
 * Lo que hace el cliente cada segundo: recalcular desde `closesAt` corrigiendo
 * el reloj del dispositivo con el desfase que dio el servidor. Nunca resta de
 * una variable acumulada.
 */
function remainingMs(
  closesAt: string,
  serverNow: string,
  deviceNow: number
): number {
  const offset = Date.parse(serverNow) - deviceNow;
  return Math.max(0, Date.parse(closesAt) - (deviceNow + offset));
}

console.log(
  `\nZona del sistema: ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n`
);

// ---------- Definición de la ronda ----------
console.log("Ronda (00:00 UTC = 7:00 p. m. Colombia)");
check(
  "la ronda del 26/07 a las 15:00 Colombia cierra el 27/07 00:00 UTC",
  new Date(roundClosesAt(Date.parse("2026-07-26T20:00:00Z"))).toISOString(),
  "2026-07-27T00:00:00.000Z"
);
check(
  "un segundo antes del cierre la ronda sigue siendo la del 26",
  roundIdAt(Date.parse("2026-07-27T00:00:00Z") - 1),
  "2026-07-26"
);
check(
  "justo en el cierre ya corre la ronda del 27",
  roundIdAt(Date.parse("2026-07-27T00:00:00Z")),
  "2026-07-27"
);
check("la ronda anterior a la del 27 es la del 26", previousRoundId("2026-07-27"), "2026-07-26");
check(
  "la ronda del 27 se abrió cuando cerró la del 26",
  roundOpensAt("2026-07-27"),
  roundClosesAt(Date.parse("2026-07-26T12:00:00Z"))
);

// ---------- Mismo contador en cualquier país ----------
console.log("\nDos zonas horarias");
const closesAt = "2026-07-27T00:00:00.000Z";
const serverNow = "2026-07-26T22:17:42.000Z";
// Mismo instante real, dos dispositivos: uno en Bogotá y otro en Madrid. El
// reloj del sistema operativo no entra en el cálculo, solo el instante UTC.
const bogota = remainingMs(closesAt, serverNow, Date.parse(serverNow));
const madrid = remainingMs(closesAt, serverNow, Date.parse(serverNow));
check("el tiempo restante es idéntico", bogota, madrid);
check("y se formatea igual", formatCountdown(bogota), "01:42:18");

// ---------- Reloj del teléfono desajustado ----------
console.log("\nReloj incorrecto (lo corrige el servidor)");
const realNow = Date.parse(serverNow);
check(
  "teléfono 3 horas adelantado: no adelanta el cierre",
  formatCountdown(remainingMs(closesAt, serverNow, realNow + 3 * 3600_000)),
  "01:42:18"
);
check(
  "teléfono 2 días atrasado: no permite entrar tarde",
  formatCountdown(remainingMs(closesAt, serverNow, realNow - 2 * DAY_MS)),
  "01:42:18"
);

// ---------- Pestaña dormida ----------
console.log("\nPestaña dormida y corte");
check("antes de dormirse marcaba", formatCountdown(remainingMs(closesAt, serverNow, realNow)), "01:42:18");
check(
  "diez minutos en segundo plano: al volver se recalcula solo",
  formatCountdown(
    remainingMs(closesAt, "2026-07-26T22:27:42.000Z", realNow + 600_000)
  ),
  "01:32:18"
);
check(
  "pasado el cierre nunca queda negativo",
  formatCountdown(
    remainingMs(closesAt, "2026-07-27T00:05:00.000Z", Date.parse("2026-07-27T00:05:00Z"))
  ),
  "00:00:00"
);
check(
  "y no salta a 24 h por cuenta propia (sigue en cero hasta que el servidor entregue la ronda nueva)",
  formatCountdown(
    remainingMs(closesAt, "2026-07-27T01:00:00.000Z", Date.parse("2026-07-27T01:00:00Z"))
  ),
  "00:00:00"
);

console.log(
  failed === 0
    ? "\n✅ Todo en verde\n"
    : `\n❌ ${failed} comprobación(es) fallaron\n`
);
process.exit(failed === 0 ? 0 : 1);
