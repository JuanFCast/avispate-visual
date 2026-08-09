// Comprueba la regla del 2026-08-08: en una mesa con entrada, quien actúa es la
// wallet que probó la ficha de silla, no el perfil de la sesión.
//
// El invariante que de verdad se está protegiendo, dicho como lo dijo Juan: si
// la transacción quedó confirmada on-chain, ni un fallo de Privy ni una
// diferencia de perfiles puede impedirle jugar al verdadero pagador. Por eso el
// caso que más importa aquí es el de la sesión ausente o ajena — los dos tienen
// que dar exactamente el mismo resultado que la sesión correcta.
//
// Correr: node scripts/verify-arena-actor.ts

import { decideActor } from "../lib/arena-seat.ts";

let fallos = 0;

function check(what: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fallos++;
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) console.log(`    esperaba ${JSON.stringify(want)}, salió ${JSON.stringify(got)}`);
}

const SILLA = "perfil-de-la-wallet-que-pago";
const SESION = "perfil-de-la-sesion";

console.log("— Mesa con entrada: manda la silla —");
{
  // El caso corriente: los dos perfiles coinciden porque la wallet del perfil
  // es la que pagó. Sale el de la silla, que es el mismo.
  check(
    "sesión y silla de acuerdo",
    decideActor({ escrowed: true, sessionProfileId: SILLA, seatProfileId: SILLA }),
    { ok: true, profileId: SILLA }
  );

  // El caso que motivó todo: el jugador de Privy cuyo perfil no tiene escrita
  // la dirección con la que pagó. Antes actuaba con el perfil de la sesión y su
  // silla era de otro; ahora actúa como su silla.
  check(
    "perfiles distintos: gana la silla, no la sesión",
    decideActor({ escrowed: true, sessionProfileId: SESION, seatProfileId: SILLA }),
    { ok: true, profileId: SILLA }
  );

  // Privy caído, sesión vencida, MiniPay sin sesión todavía: da igual. La silla
  // está pagada y probada, así que se juega.
  check(
    "sin sesión ninguna: se juega igual",
    decideActor({ escrowed: true, sessionProfileId: null, seatProfileId: SILLA }),
    { ok: true, profileId: SILLA }
  );

  // Y la otra mitad de la regla: una sesión no puede sustituir a la silla. Sin
  // fila pagada no se actúa, por muy buena que sea la sesión que se traiga.
  check(
    "sesión válida pero silla sin registrar: no se actúa",
    decideActor({ escrowed: true, sessionProfileId: SESION, seatProfileId: null }),
    { ok: false, error: "seat_not_registered" }
  );
}

console.log("\n— Y la sesión no entra en la decisión —");
{
  // La comprobación fuerte: con la misma silla, cambiar la sesión por cualquier
  // otra cosa no puede alterar el resultado. Si algún día alguien vuelve a
  // colar el perfil de la sesión en este camino, esto lo caza.
  const sesiones = [null, SESION, SILLA, "perfil-de-un-desconocido"];
  const salidas = sesiones.map((s) =>
    JSON.stringify(
      decideActor({ escrowed: true, sessionProfileId: s, seatProfileId: SILLA })
    )
  );
  check(
    "cuatro sesiones distintas, un solo resultado",
    new Set(salidas).size,
    1
  );
}

console.log("\n— Mesa gratis: sigue mandando la sesión —");
{
  check(
    "con sesión",
    decideActor({ escrowed: false, sessionProfileId: SESION, seatProfileId: null }),
    { ok: true, profileId: SESION }
  );

  check(
    "sin sesión",
    decideActor({ escrowed: false, sessionProfileId: null, seatProfileId: null }),
    { ok: false, error: "unauthorized" }
  );

  // Una sala gratis no tiene sillas pagadas, pero si por lo que sea llegara una
  // fila con wallet, no puede convertirse en la autoridad: ahí no hubo pago que
  // la respalde.
  check(
    "una fila con wallet no manda en una sala gratis",
    decideActor({ escrowed: false, sessionProfileId: SESION, seatProfileId: SILLA }),
    { ok: true, profileId: SESION }
  );
}

console.log(
  fallos === 0
    ? "\nTodo en orden."
    : `\n${fallos} comprobación(es) fallida(s).`
);
process.exit(fallos === 0 ? 0 : 1);
