// El canje del hash por sesión de wallet, y por qué necesita reintentos.
//
// Caso real (2026-08-15, MiniPay): la transacción se minó a las 03:04:36.000Z y
// `/api/session/wallet` se llamó a las 03:04:36.57 — 570 ms después. El nodo de
// Celo del servidor todavía no tenía el recibo, `verifyWalletControl` no lo
// encontró y devolvió 403. El canje se rendía al primer intento, así que dentro
// de MiniPay —donde la sesión de wallet es la ÚNICA que hay— no se creaba
// ninguna: `wallet_sessions` no tenía una sola fila de PipeMini desde el 8 de
// agosto, y sin sesión no hay perfil, ni alias propio, ni Arena.
//
// `/api/plays` nunca sufrió esto porque va por la bandeja, que reintenta.
//
// Aquí se comprueba la política de reintento sin navegador ni red: qué se
// reintenta, qué no, y que un 403 pasajero acabe en sesión.
//
// Correr: node scripts/verify-wallet-session-canje.ts

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/**
 * La MISMA clasificación que `canjearUnaVez` en `lib/wallet-session-client.ts`.
 * Abajo se comprueba contra el archivo real que sigue siendo esta.
 */
type Salida = "ok" | "reintentar" | "no";

function clasificar(status: number, error?: string): Salida {
  if (status >= 200 && status < 300) return "ok";
  if (status === 403 && error === "tx_not_valid") return "reintentar";
  if (status >= 500) return "reintentar";
  return "no";
}

/* ── 1. Qué se reintenta y qué no ────────────────────────────────────────── */

console.log("\n— 1. Solo se reintenta lo que mejora con el tiempo —\n");

{
  const casos: Array<[string, number, string | undefined, Salida]> = [
    ["el nodo aún no ve la transacción (403 tx_not_valid)", 403, "tx_not_valid", "reintentar"],
    ["el servidor se cae (500)", 500, "session_failed", "reintentar"],
    ["el perfil no se pudo asegurar (500)", 500, "profile_failed", "reintentar"],
    ["el hash YA se canjeó (409)", 409, "tx_already_used", "no"],
    ["login de wallet apagado (503)", 503, "wallet_login_disabled", "reintentar"],
    ["dirección inválida (400)", 400, "invalid_address", "no"],
    ["hash inválido (400)", 400, "invalid_tx", "no"],
    ["canje correcto (200)", 200, undefined, "ok"],
  ];
  for (const [nombre, status, error, esperado] of casos) {
    ok(`${nombre} → ${esperado}`, clasificar(status, error) === esperado);
  }

  /**
   * El 503 merece una nota: `walletSessionEnabled()` es una comprobación de
   * configuración del servidor, no algo que cambie solo. Cae en "reintentar"
   * por la regla general de los 5xx y eso solo cuesta tres intentos en vano —
   * preferible a la alternativa, que sería tratar un 5xx como definitivo.
   */
  ok(
    "un 403 que NO sea tx_not_valid no se reintenta",
    clasificar(403, "otra_cosa") === "no"
  );
}

/* ── 2. Un 403 pasajero acaba en sesión ─────────────────────────────────── */

console.log("\n— 2. El retraso del nodo deja de costar la sesión —\n");

{
  const DELAYS = [800, 2000, 5000];

  /** Simula el bucle de `ensureWalletSession` con un servidor guionizado. */
  function canjear(respuestas: Array<[number, string | undefined]>): {
    conseguida: boolean;
    intentos: number;
  } {
    let intentos = 0;
    for (let i = 0; i <= DELAYS.length; i++) {
      const [status, error] = respuestas[Math.min(i, respuestas.length - 1)];
      intentos++;
      const salida = clasificar(status, error);
      if (salida !== "reintentar") return { conseguida: salida === "ok", intentos };
    }
    return { conseguida: false, intentos };
  }

  const tarde = canjear([
    [403, "tx_not_valid"], // el caso real: el nodo va 570 ms por detrás
    [200, undefined],
  ]);
  ok(
    "403 en el primer intento y 200 en el segundo → sesión creada",
    tarde.conseguida && tarde.intentos === 2,
    JSON.stringify(tarde)
  );

  const muyTarde = canjear([
    [403, "tx_not_valid"],
    [403, "tx_not_valid"],
    [403, "tx_not_valid"],
    [200, undefined],
  ]);
  ok(
    "aguanta hasta tres retrasos seguidos",
    muyTarde.conseguida && muyTarde.intentos === 4,
    JSON.stringify(muyTarde)
  );

  const nunca = canjear([[403, "tx_not_valid"]]);
  ok(
    "y si nunca aparece, se rinde acotado (4 intentos, no un bucle)",
    !nunca.conseguida && nunca.intentos === 4,
    JSON.stringify(nunca)
  );

  const gastado = canjear([[409, "tx_already_used"]]);
  ok(
    "un hash ya gastado no se reintenta ni una vez",
    !gastado.conseguida && gastado.intentos === 1,
    JSON.stringify(gastado)
  );

  const total = DELAYS.reduce((a, b) => a + b, 0);
  ok(
    "la espera total es de segundos, no de minutos",
    total <= 10_000,
    `${total}ms`
  );
}

/* ── 3. El código real conserva esta política ───────────────────────────── */

console.log("\n— 3. Y el cliente de verdad hace esto —\n");

{
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fuente = readFileSync(join(ROOT, "lib/wallet-session-client.ts"), "utf8");

  ok(
    "el 403 tx_not_valid se reintenta",
    /res\.status === 403 && data\?\.error === "tx_not_valid"\) return "reintentar"/.test(
      fuente
    )
  );
  ok("los 5xx se reintentan", /res\.status >= 500\) return "reintentar"/.test(fuente));
  ok(
    "hay un tope de intentos, no un bucle",
    /for \(let intento = 0; intento <= CANJE_DELAYS\.length; intento\+\+\)/.test(fuente)
  );
  ok(
    "el canje sigue sin lanzar nunca (la partida no puede caerse por esto)",
    /catch \{\s*\/\/[\s\S]{0,120}return "reintentar";/.test(fuente)
  );
  ok(
    "y sigue saliendo temprano si ya hay sesión para esa wallet",
    /if \(current && current\.address === address\.toLowerCase\(\)\) return true;/.test(
      fuente
    )
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
