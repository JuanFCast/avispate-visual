// Verifica la ficha de silla: que valga SOLO para su mesa, que caduque, que no
// se pueda falsificar ni confundir con una sesión de cuenta.
//
// Correr: node scripts/verify-seat-token.ts
//
// Se pone un secreto de prueba en el entorno antes de importar: el módulo lo
// lee al firmar, no al cargarse.
export {}; // marca el archivo como módulo: hace falta para el `await` de arriba

process.env.WALLET_SESSION_SECRET =
  "secreto-de-prueba-para-fichas-de-silla-0123456789";

const { signSeatToken, verifySeatToken, looksLikeSeatToken } = await import(
  "../lib/seat-token.ts"
);
const { signWalletSession, looksLikeWalletSession } = await import(
  "../lib/wallet-session.ts"
);

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

const MESA = "0xaaa1";
const OTRA = "0xbbb2";
const ALICE = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";

const HORA = 60 * 60 * 1000;

console.log("\n— Dice a qué mesa y a qué dirección da acceso —");

{
  const token = signSeatToken({ tableId: MESA, address: ALICE });
  check("la ficha se verifica", verifySeatToken(token), {
    tableId: MESA,
    address: ALICE,
  });
}

{
  // Quien la emite no controla las mayúsculas de lo que le llega.
  const token = signSeatToken({
    tableId: MESA.toUpperCase(),
    address: ALICE.toUpperCase(),
  });
  check("todo se normaliza a minúsculas", verifySeatToken(token), {
    tableId: MESA,
    address: ALICE,
  });
}

console.log("\n— No sirve para otra mesa: lo comprueba quien la usa —");

{
  const token = signSeatToken({ tableId: MESA, address: ALICE });
  const claims = verifySeatToken(token)!;
  // La ficha NO dice "sí" a secas: dice de qué mesa es, y `arena-seat.ts` la
  // compara contra la mesa sobre la que se actúa.
  check("la mesa viaja dentro y no es la otra", claims.tableId !== OTRA, true);
}

console.log("\n— Caduca, y corto —");

{
  const ahora = Date.now();
  const token = signSeatToken({ tableId: MESA, address: ALICE }, ahora);
  check(
    "a la hora y media sigue viva (una sala dura dos horas)",
    verifySeatToken(token, ahora + 1.5 * HORA)?.address,
    ALICE
  );
  check(
    "a las dos horas y un minuto ya no",
    verifySeatToken(token, ahora + 2 * HORA + 60_000),
    null
  );
}

console.log("\n— No se puede falsificar —");

{
  const token = signSeatToken({ tableId: MESA, address: ALICE });
  const [prefijo, payload, firma] = token.split(".");

  check("firma cambiada → null", verifySeatToken(`${prefijo}.${payload}.AAAA`), null);
  check(
    "payload cambiado con la firma vieja → null",
    verifySeatToken(
      `${prefijo}.${Buffer.from(
        JSON.stringify({ t: OTRA, a: ALICE, e: Date.now() + HORA })
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")}.${firma}`
    ),
    null
  );
  check("basura → null", verifySeatToken("cualquier-cosa"), null);
  check("vacío → null", verifySeatToken(""), null);
}

console.log("\n— No es una sesión de cuenta, ni se confunde con una —");

{
  const seat = signSeatToken({ tableId: MESA, address: ALICE });
  const sesion = signWalletSession(ALICE);

  check("la ficha no parece sesión de wallet", looksLikeWalletSession(seat), false);
  check("la sesión de wallet no parece ficha", looksLikeSeatToken(sesion), false);
  // Llaves distintas: aunque alguien mandara una por el camino de la otra, no
  // verifica. Es el candado que impide que una silla se vuelva una cuenta.
  check("una sesión de wallet NO vale como ficha", verifySeatToken(sesion), null);
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
