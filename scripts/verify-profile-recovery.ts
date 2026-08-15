// El bug: "estamos comprobando tu cuenta" para siempre, en MiniPay y en
// Chrome. La causa real era que `fetch("/api/profile")` no tenía tope de
// tiempo, así que una petición colgada dejaba `loading` pegado en `true` — y
// `canonicalFromProfile` (`lib/wallet-identity.ts`) reporta `loading` Y
// `failed` como el mismo "cargando", así que ni siquiera fallar destrababa
// nada. Solo cerrar sesión y volver a entrar forzaba un `refresh()` nuevo.
//
// Esto prueba, sin navegador, los seis puntos que Juan pidió cubrir:
//   1. una petición colgada termina por timeout, no se queda cargando para siempre
//   2. después del timeout hay una ruta de reintento real, sin logout/login
//   3. una respuesta vieja no puede pisar a un refresh más nuevo
//   4. un 401 de sesión limpia SOLO la sesión inválida y se puede recuperar
//   5. timeout / error de red / 5xx NUNCA se leen como sesión inválida
//   6. el aviso "checking" se limpia solo, pero nunca habilita un cobro
// Y además: que "Cerrar sesión" esté oculto dentro de MiniPay (no como parche
// del bug, sino porque la recuperación automática ya no lo necesita), y que
// `isMiniPay()` distinga de forma confiable MiniPay de un navegador normal.
//
// Correr: node scripts/verify-profile-recovery.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  callWithTimeout,
  createSequenceGate,
  createSingleFlight,
  decideProfileRefreshAction,
  fetchProfileWithTimeout,
  PROFILE_SETTLE_LIMIT_MS,
  TOKEN_REQUEST_TIMEOUT_MS,
  type ProfileFetchOutcome,
} from "../lib/profile-recovery.ts";
import { decidePlayStart } from "../lib/pay-guard.ts";
import { decideLobbyCta } from "../lib/lobby-cta.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

function fakeResponse(status: number): Response {
  return new Response(null, { status });
}

/* ── 1. Una petición colgada termina por timeout, no se queda cargando ──── */

console.log("\n— 1. Colgada de verdad: no se queda cargando para siempre —\n");

{
  // `run` nunca resuelve por sí sola — solo reacciona al abort. Es la
  // situación exacta que producía el bug: un fetch que ni responde ni falla.
  const colgada = (signal: AbortSignal): Promise<Response> =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });

  const start = Date.now();
  const outcome = await fetchProfileWithTimeout(colgada, 80);
  const elapsedMs = Date.now() - start;

  ok(
    "una petición que nunca resuelve por sí sola SÍ resuelve, por timeout",
    outcome.kind === "timeout",
    JSON.stringify(outcome)
  );
  ok(
    "resuelve cerca del propio tope, no se queda esperando de más",
    elapsedMs < 80 + 500,
    `tardó ${elapsedMs}ms con un tope de 80ms`
  );
}

{
  // Con un `run` que SÍ responde a tiempo, el timeout no interfiere.
  const rapida = async (): Promise<Response> => fakeResponse(200);
  const outcome = await fetchProfileWithTimeout(rapida, 5000);
  ok(
    "una petición normal no se confunde con un timeout",
    outcome.kind === "ok" && outcome.response.status === 200,
    JSON.stringify(outcome)
  );
}

/* ── 2. Después del timeout, ruta de reintento real sin logout/login ────── */

console.log("\n— 2. Reintentar de verdad recupera la cuenta, sin cerrar sesión —\n");

{
  // El mismo mecanismo que usaría un segundo `refresh()`: primero cuelga,
  // como cualquier petición real puede colgar una vez; el reintento (misma
  // función, sin remontar nada, sin logout) esta vez responde bien.
  const colgada = (signal: AbortSignal): Promise<Response> =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const primero = await fetchProfileWithTimeout(colgada, 50);
  const primeraAccion = decideProfileRefreshAction(primero, {
    usingWalletSession: false,
  });
  ok(
    "el primer intento (colgado) queda como recuperable, no como final",
    primeraAccion.kind === "failed",
    JSON.stringify(primeraAccion)
  );

  const reintento = await fetchProfileWithTimeout(
    async () => fakeResponse(200),
    5000
  );
  const segundaAccion = decideProfileRefreshAction(reintento, {
    usingWalletSession: false,
  });
  ok(
    "reintentar la MISMA función después de un fallo sí puede tener éxito",
    segundaAccion.kind === "success",
    JSON.stringify(segundaAccion)
  );
}

{
  // La ruta real en la UI: `HomeLobby.tsx` ofrece "reintentar/recargar"
  // cuando `profile.failed`, y ese botón llama a `profile.refresh()` — nunca
  // a `logoutEverything`.
  const lobby = readFileSync(
    join(ROOT, "components/lobby/HomeLobby.tsx"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  // La decisión vive en `lib/lobby-cta.ts` desde que se sacó del componente, y
  // aquí se EJECUTA en vez de leerse: un perfil fallido tiene que ofrecer
  // reintentar, y encima habilitado.
  const perfilCaido = decideLobbyCta({
    blockedByPending: false,
    profileReady: true,
    authenticated: true,
    profileLoading: false,
    profileFailed: true,
    profileAlias: "Pipe",
    walletConnected: true,
    walletReconnecting: false,
    embeddedStatus: "ready",
    inMiniPay: false,
    canOpenConnectModal: true,
    walletAliasReady: true,
    walletAlias: "Pipe",
    entitlementReady: true,
    freeForDeck: true,
  });
  ok(
    "hay un CTA dedicado para perfil fallido (profile.authenticated && profile.failed)",
    perfilCaido.reason === "profile/failed",
    JSON.stringify(perfilCaido)
  );
  ok(
    'ese CTA es accionable (action: "reload")',
    perfilCaido.action === "reload" && !perfilCaido.disabled
  );

  const onPress = lobby.slice(lobby.indexOf("onPress={() => {"));
  ok(
    "\"reload\" llama a profile.refresh(), no a un logout",
    /cta\.action === "reload"[\s\S]{0,40}profile\.refresh\(\)/.test(onPress),
    "el botón de reintentar tiene que reintentar, no cerrar sesión"
  );
  ok(
    "el camino de reintento no pasa por logoutEverything",
    !/logoutEverything/.test(lobby)
  );
}

/* ── 3. Una respuesta vieja no pisa a un refresh más nuevo ───────────────── */

console.log("\n— 3. Orden de llegada no manda: manda quién arrancó último —\n");

{
  const gate = createSequenceGate();
  const viejo = gate.begin();
  const nuevo = gate.begin();

  ok("el más nuevo sigue siendo el vigente", gate.isCurrent(nuevo));
  ok(
    "el viejo ya no puede publicar, aunque responda después",
    !gate.isCurrent(viejo)
  );

  // Un tercer `refresh()` (p. ej. el reintento manual del punto 2) vuelve a
  // desplazar al que hoy es "nuevo".
  const masNuevo = gate.begin();
  ok(
    "y un tercero desplaza al segundo exactamente igual",
    gate.isCurrent(masNuevo) && !gate.isCurrent(nuevo)
  );
}

/* ── 4 y 5. Qué SÍ y qué NO cuenta como "sesión de wallet inválida" ──────── */

console.log("\n— 4. Un 401 con sesión de wallet limpia SOLO esa sesión —\n");

{
  const outcome: ProfileFetchOutcome = { kind: "ok", response: fakeResponse(401) };
  const action = decideProfileRefreshAction(outcome, { usingWalletSession: true });
  ok(
    "401 + sesión de wallet → limpiar la sesión (no un fallo genérico)",
    action.kind === "clear_invalid_session",
    JSON.stringify(action)
  );
}

{
  // Después de limpiar, un intento posterior con la sesión NUEVA (ya no
  // "usingWalletSession" contra la vieja, porque esa ya no existe) puede
  // tener éxito: no queda ninguna marca que impida recuperarse.
  const reintento = await fetchProfileWithTimeout(
    async () => fakeResponse(200),
    5000
  );
  const action = decideProfileRefreshAction(reintento, { usingWalletSession: false });
  ok(
    "y después de limpiar, la cuenta se puede recuperar sin logout",
    action.kind === "success",
    JSON.stringify(action)
  );
}

console.log(
  "\n— 5. Timeout / error de red / 5xx NUNCA se leen como sesión inválida —\n"
);

{
  const timeout: ProfileFetchOutcome = { kind: "timeout" };
  const redError: ProfileFetchOutcome = { kind: "network_error", error: new Error("offline") };
  const quinientos: ProfileFetchOutcome = { kind: "ok", response: fakeResponse(500) };

  for (const [nombre, outcome] of [
    ["timeout", timeout],
    ["error de red", redError],
    ["500 del servidor", quinientos],
  ] as const) {
    const action = decideProfileRefreshAction(outcome, { usingWalletSession: true });
    ok(
      `${nombre} con sesión de wallet → NUNCA "clear_invalid_session"`,
      action.kind !== "clear_invalid_session",
      JSON.stringify(action)
    );
    ok(`${nombre} con sesión de wallet → "failed" (recuperable)`, action.kind === "failed");
  }

  // Un 401 real, pero con un token de PRIVY (no de wallet): tampoco es motivo
  // para tocar `clearWalletSession()` — esa sesión ni siquiera es la que se
  // usó para pedir el perfil.
  const cuatroCeroUno: ProfileFetchOutcome = { kind: "ok", response: fakeResponse(401) };
  const accionPrivy = decideProfileRefreshAction(cuatroCeroUno, {
    usingWalletSession: false,
  });
  ok(
    "401 con token de Privy (no de wallet) tampoco limpia la sesión de wallet",
    accionPrivy.kind === "failed",
    JSON.stringify(accionPrivy)
  );
}

/* ── 6. "checking" se limpia solo, pero nunca habilita un cobro ─────────── */

console.log("\n— 6. El aviso se limpia solo; el permiso de cobrar es otra cosa —\n");

{
  // `decidePlayStart` no recibe `payBlock` en absoluto — estructuralmente no
  // puede leer "ya se limpió el aviso" como permiso. Mientras el perfil siga
  // "loading", la respuesta es SIEMPRE "checking", nunca "proceed".
  const decision = decidePlayStart({
    expected: "0xabc",
    probe: { status: "answered", accounts: ["0xabc"] },
    pending: null,
    canonical: { status: "loading" },
  });
  ok(
    'con canonical "loading" la decisión es SIEMPRE "checking"',
    decision.kind === "checking",
    JSON.stringify(decision)
  );
  ok(
    'y nunca "proceed" mientras no se sepa de quién es la cuenta',
    decision.kind !== "proceed"
  );
}

{
  const gameShell = readFileSync(
    join(ROOT, "components/GameShell.tsx"),
    "utf8"
  ).replace(/\r\n/g, "\n");

  const marker = 'if (payBlock?.kind !== "checking") return;';
  const start = gameShell.indexOf(marker);
  ok("el efecto que limpia \"checking\" existe", start !== -1);

  const depsMarker = "}, [payBlock?.kind, canonical.status]);";
  const end = gameShell.indexOf(depsMarker, start);
  ok("y tiene el cierre esperado (mismas dependencias)", end !== -1);

  const body = start !== -1 && end !== -1 ? gameShell.slice(start, end) : "";

  ok(
    "el efecto SOLO limpia el aviso — nada de iniciar cobro ni partida",
    body.length > 0 &&
      /setPayBlock\(null\)/.test(body) &&
      !/playForDeck|startGame\(|setPayStage\(|handleStart\(|enqueue\(/.test(body),
    body || "no se pudo aislar el cuerpo del efecto"
  );

  /**
   * El aviso dura EXACTAMENTE lo que dura su motivo.
   *
   * Esto miraba `profile.loading`, y ese era el fallo: el guardián frena cuando
   * `canonical.status === "loading"`, que según `canonicalFromProfile` también
   * cubre "el perfil no está listo" y "el perfil falló". Al no coincidir las dos
   * condiciones, había estados en los que el cobro seguía bloqueado y el aviso
   * se borraba en el mismo instante — la persona pulsaba Jugar y no pasaba nada,
   * sin mensaje y sin jugada.
   *
   * Limpiar sigue sin autorizar nada (lo comprueba el caso de arriba): solo
   * decide si el aviso se sigue mostrando, y ahora lo hace por la causa real.
   */
  ok(
    "la condición para limpiar es la MISMA que frenó la jugada (canonical)",
    /if \(canonical\.status === "loading"\) return;/.test(body)
  );
  ok(
    "y ya no se decide con profile.loading, que no es lo que frena el cobro",
    !/profile\.loading/.test(body),
    body
  );
}

/* ── "Cerrar sesión" oculto en MiniPay, visible en navegador normal ─────── */

console.log("\n— Cerrar sesión: oculto en MiniPay, presente fuera —\n");

{
  const perfil = readFileSync(join(ROOT, "app/perfil/page.tsx"), "utf8").replace(
    /\r\n/g,
    "\n"
  );

  ok(
    "la página importa useIsMiniPay de lib/minipay",
    /import\s*\{\s*useIsMiniPay\s*\}\s*from\s*"@\/lib\/minipay"/.test(perfil)
  );
  ok(
    "lee inMiniPay con el hook, no con una variable inventada",
    /const inMiniPay = useIsMiniPay\(\);/.test(perfil)
  );

  const botonIdx = perfil.indexOf('profile-logout-link"');
  const boton = perfil.slice(botonIdx);
  const justoAntes = perfil.slice(Math.max(0, botonIdx - 200), botonIdx);
  ok(
    "el botón de cerrar sesión sigue existiendo (no se borró, se oculta)",
    /onClick=\{handleLogout\}/.test(boton)
  );
  ok(
    "el botón está envuelto por \"{!inMiniPay &&\" a menos de 200 caracteres",
    /\{!inMiniPay\s*&&/.test(justoAntes),
    justoAntes
  );
  ok(
    "el aviso de \"cierra sesión para cambiar de cuenta\" se oculta con el botón",
    /profile\.links\.hint/.test(
      perfil.slice(
        perfil.indexOf('profile-logout-link"'),
        perfil.indexOf('profile-legal"')
      )
    )
  );
}

/* ── Fiabilidad de isMiniPay(): ni falsos positivos ni falsos negativos ── */

console.log("\n— isMiniPay(): fiable en MiniPay, silenciosa en Chrome/Safari —\n");

{
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalEnv = process.env.NODE_ENV;
  // Next.js declara `NODE_ENV` como solo-lectura en `NodeJS.ProcessEnv`; el
  // valor SÍ es mutable en runtime, solo el tipo lo prohíbe.
  const env = process.env as Record<string, string | undefined>;

  function withWindow<T>(win: unknown, run: () => T): T {
    (globalThis as { window?: unknown }).window = win;
    try {
      return run();
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
  }

  try {
    // Import dinámico: `lib/minipay.ts` es "use client" e importa hooks de
    // React/wagmi, pero `isMiniPay()` en sí no usa ninguno — solo lee
    // `window`. Se importa DESPUÉS de decidir el mock para que la primera
    // lectura de `window` ya encuentre lo que la prueba espera.
    delete (globalThis as { window?: unknown }).window;
    const { isMiniPay } = await import("../lib/minipay.ts");

    ok(
      "sin window (servidor/SSR) nunca revienta ni da falso positivo",
      withWindow(undefined, () => isMiniPay()) === false
    );

    ok(
      "Chrome/Safari sin ninguna wallet inyectada → false",
      withWindow({ location: { search: "" } }, () => isMiniPay()) === false
    );

    ok(
      "Chrome con MetaMask inyectado (isMiniPay ausente) → false",
      withWindow(
        {
          ethereum: { isMetaMask: true },
          location: { search: "" },
        },
        () => isMiniPay()
      ) === false
    );

    ok(
      "una wallet que dice isMiniPay: false explícito → false",
      withWindow(
        { ethereum: { isMiniPay: false }, location: { search: "" } },
        () => isMiniPay()
      ) === false
    );

    ok(
      "MiniPay real (window.ethereum.isMiniPay === true) → true",
      withWindow(
        { ethereum: { isMiniPay: true }, location: { search: "" } },
        () => isMiniPay()
      ) === true
    );

    env.NODE_ENV = "production";
    ok(
      "en producción, ?minipay=1 NO puede fingir estar en MiniPay",
      withWindow(
        {
          ethereum: undefined,
          location: { search: "?minipay=1" },
        },
        () => isMiniPay()
      ) === false,
      "el override de desarrollo tiene que estar bloqueado en producción"
    );

    env.NODE_ENV = "development";
    ok(
      "fuera de producción, ?minipay=1 sí sirve para probar la UI",
      withWindow(
        {
          ethereum: undefined,
          location: { search: "?minipay=1" },
        },
        () => isMiniPay()
      ) === true
    );
  } finally {
    env.NODE_ENV = originalEnv;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
}

/* ==========================================================================
 * El MISMO cuelgue, por las otras dos puertas que quedaron abiertas
 * --------------------------------------------------------------------------
 * Foto real del 2026-08-14, Chrome de escritorio: el lobby en "Comprobando tu
 * entrada… / Preparando…" y el modal en "Comprobando tu perfil…", los tres a
 * la vez y para siempre. Los tres salen de la MISMA condición
 * (`profile.authenticated && profile.loading`), así que el perfil se quedó
 * cargando sin publicar nunca un resultado — ni bueno ni malo.
 *
 * El timeout del `fetch` de arriba no lo cubría, porque ninguna de las dos
 * causas llega a hacer el fetch.
 * ========================================================================== */
console.log("\n— A. El token también tiene tope: un SDK colgado no cuelga el perfil —");
{
  // `await getToken()` iba SIN tope: llama a `getAccessToken()` de Privy, que
  // habla con su iframe y puede no volver nunca. Colgada ahí, `refresh()` no
  // llegaba a `publish()` y `loading` se quedaba en true para siempre.
  const colgada = await callWithTimeout(
    () => new Promise<string>(() => {}),
    30
  );
  ok(
    "una llamada que no vuelve NUNCA termina por timeout",
    colgada.kind === "timeout",
    `recibido ${JSON.stringify(colgada)}`
  );

  const buena = await callWithTimeout(async () => "token-bueno", 1_000);
  ok(
    "y una que sí contesta devuelve su valor",
    buena.kind === "ok" && buena.value === "token-bueno"
  );

  const rota = await callWithTimeout(async () => {
    throw new Error("privy_down");
  }, 1_000);
  ok(
    "un SDK que LANZA se distingue de uno mudo",
    rota.kind === "error",
    `recibido ${JSON.stringify(rota.kind)}`
  );

  // Lo que importa para el jugador: las tres formas de no tener token acaban
  // en `failed`, que el lobby SÍ sabe ofrecer con un botón de reintentar
  // (`cta.profile_failed`), mientras que "cargando" no ofrece nada.
  ok(
    "ninguna de las tres se queda esperando",
    [colgada.kind, buena.kind, rota.kind].every((k) =>
      ["ok", "timeout", "error"].includes(k)
    )
  );

  ok(
    "el tope del token es más corto que el del perfil (no es una ida y vuelta a nuestro servidor)",
    TOKEN_REQUEST_TIMEOUT_MS > 0 && TOKEN_REQUEST_TIMEOUT_MS <= 12_000
  );

  const ctx = readFileSync(join(ROOT, "lib/profile-context.tsx"), "utf8");
  ok(
    "y `refresh()` lo usa de verdad, en vez del await pelado",
    /callWithTimeout\(getToken, TOKEN_REQUEST_TIMEOUT_MS\)/.test(ctx),
    "el `await getToken()` sin tope es exactamente el cuelgue"
  );
  ok(
    "ya no queda ningún `await getToken()` sin acotar en refresh",
    /const token = await getToken\(\);/.test(ctx) === false
  );
}

console.log("\n— B. El refresco no puede dispararse en bucle y descartarse a sí mismo —");
{
  /*
   * El efecto colgaba de `refresh`, que cuelga de `getToken`, que cuelga de
   * `getAccessToken` de Privy. Si el SDK devuelve una función nueva por
   * render, el efecto corre en CADA render y `sequenceGate.begin()` sube el
   * número cada vez — así que la respuesta en vuelo se descarta siempre por
   * "ya no eres la actual" y `publish()` no se ejecuta jamás. Ni una sola
   * petición falla: en la pestaña de red todo sale 200 y la pantalla no
   * avanza.
   */
  const gate = createSequenceGate();
  const enVuelo = gate.begin();
  // Cada render vuelve a arrancar otro refresco…
  for (let render = 0; render < 5; render++) gate.begin();
  ok(
    "reproducción del bucle: la respuesta en vuelo queda descartada",
    gate.isCurrent(enVuelo) === false,
    "si esto fuera true, el bucle no explicaría el cuelgue"
  );

  const ctx = readFileSync(join(ROOT, "lib/profile-context.tsx"), "utf8");
  ok(
    "el efecto ya NO depende de la identidad de `refresh`",
    /\}, \[ready, authenticated, embeddedWallet\]\);/.test(ctx),
    "con `refresh` en las dependencias, un SDK sin memoizar vuelve a colgarlo"
  );
  ok(
    "y llama siempre a la versión más reciente por ref",
    /refreshRef\.current\(\);/.test(ctx) && /refreshRef = useRef\(refresh\)/.test(ctx)
  );
  ok(
    "poner `loading: true` no crea estado nuevo si ya estaba cargando",
    /s\.loading \? s : \{ \.\.\.s, loading: true \}/.test(ctx),
    "un objeto nuevo por render es lo que alimenta el bucle"
  );
}

console.log("\n— C. Tirar una ficha de wallet vencida NO puede colgar a quien tiene correo —");
{
  /*
   * El cuelgue de verdad, y el más difícil de ver porque no falla nada.
   *
   * `loading` se DERIVA: `state.loading || (authenticated && !state.fetched)`.
   * `EMPTY` lleva `fetched: false` ("no se ha preguntado"), lo cual es cierto
   * solo cuando no hay sesión. Publicarlo con la sesión de Privy todavía viva
   * deja `authenticated` en true y `loading` en true PARA SIEMPRE — y nada
   * vuelve a disparar el efecto, porque ninguna de sus entradas cambió.
   *
   * Se llega así: `getAccessToken()` de Privy devuelve vacío, `getToken()` cae
   * a la ficha de wallet guardada (de probar MiniPay semanas atrás), el
   * servidor la rechaza con 401 → `clear_invalid_session`.
   */
  const derivarLoading = (p: {
    authenticated: boolean;
    loading: boolean;
    fetched: boolean;
  }) => p.loading || (p.authenticated && !p.fetched);

  ok(
    "reproducción: EMPTY con sesión de correo viva deja 'cargando' eterno",
    derivarLoading({ authenticated: true, loading: false, fetched: false }) === true,
    "si esto fuera false, EMPTY no explicaría la pantalla congelada"
  );
  ok(
    "en cambio FAILED sí se asienta",
    derivarLoading({ authenticated: true, loading: false, fetched: true }) === false
  );
  ok(
    "y sin sesión, EMPTY es inofensivo (por eso la otra rama puede usarlo)",
    derivarLoading({ authenticated: false, loading: false, fetched: false }) === false
  );

  // Un 401 con ficha de wallet SIGUE limpiándola: eso no se toca.
  ok(
    "el 401 de una sesión de wallet se sigue detectando",
    decideProfileRefreshAction(
      { kind: "ok", response: { status: 401, ok: false } as Response },
      { usingWalletSession: true }
    ).kind === "clear_invalid_session"
  );

  const ctx = readFileSync(join(ROOT, "lib/profile-context.tsx"), "utf8");
  ok(
    "al limpiarla, con Privy vivo se publica FAILED (recuperable), no EMPTY",
    // `[,)]` porque la llamada llevó un segundo argumento mientras existió el
    // panel de diagnóstico. Lo que se exige es la DECISIÓN, no su forma.
    /publish\(\s*privyAuth \? FAILED : EMPTY\s*[,)]/.test(ctx),
    "publish(EMPTY) ahí es el cuelgue permanente"
  );
  ok(
    "ya no queda el publish(EMPTY) pelado en esa rama",
    /clearWalletSession\(\);\s*publish\(EMPTY\);/.test(ctx) === false
  );
}

console.log("\n— D. El último seguro: 'cargando' caduca, sea cual sea la causa —");
{
  /*
   * Tres arreglos seguidos cerraron tres puertas distintas (fetch sin tope,
   * getToken sin tope, publish con fetched:false) y la pantalla se quedó
   * igual de muerta por la siguiente. Esto no arregla causas: garantiza que
   * el jugador acabe siempre con un botón en vez de un "Preparando…" eterno.
   */
  ok(
    "el tope global supera lo que puede tardar un intento legítimo (token + perfil)",
    PROFILE_SETTLE_LIMIT_MS > TOKEN_REQUEST_TIMEOUT_MS + 12_000,
    `${PROFILE_SETTLE_LIMIT_MS}ms no deja margen a una carga lenta pero viva`
  );
  ok(
    "pero sigue siendo una espera humana, no un minuto",
    PROFILE_SETTLE_LIMIT_MS <= 30_000
  );

  const ctx = readFileSync(join(ROOT, "lib/profile-context.tsx"), "utf8");
  ok(
    "existe el vigilante sobre el estado derivado, no sobre una petición",
    /authenticated && \(state\.loading \|\| !state\.fetched\)/.test(ctx),
    "vigilar solo el fetch es lo que dejó pasar las otras dos causas"
  );
  ok(
    "y acaba en `failed`, que el lobby ofrece con botón de reintentar",
    /s\.fetched && !s\.loading \? s : FAILED/.test(ctx)
  );
  const salida = decideLobbyCta({
    blockedByPending: false,
    profileReady: true,
    authenticated: true,
    profileLoading: false,
    profileFailed: true,
    profileAlias: "Pipe",
    walletConnected: true,
    walletReconnecting: false,
    embeddedStatus: "ready",
    inMiniPay: false,
    canOpenConnectModal: true,
    walletAliasReady: true,
    walletAlias: "Pipe",
    entitlementReady: true,
    freeForDeck: true,
  });
  ok(
    "el lobby de verdad tiene esa salida",
    salida.support === "cta.profile_failed.support" &&
      salida.label === "cta.profile_failed.label",
    JSON.stringify(salida)
  );
}

console.log("\n— E. Refreshes SOLAPADOS: una respuesta 200 no puede quedar huérfana —");
{
  /*
   * El caso que cazó el panel `?debugProfile=1` en producción:
   *
   *   /api/profile = 200        token = ok
   *   state.loading (crudo) = false     fetched = false     failed = false
   *   loading (derivado) = true
   *   ultimo publish = "OK DESCARTADO"  descartados = 2
   *   refresh() = 4             sequenceGate = 4
   *
   * Cuatro refreshes solapados (los tres del efecto de montaje más el
   * `await refresh()` de `wallet-auth.ts` tras firmar). El último entraba con
   * un CLOSURE VIEJO —`authenticated` capturado antes del login— publicaba
   * EMPTY sin tocar la red, y por ser instantáneo le ganaba a los fetches en
   * vuelo. El gate descartaba la respuesta buena y el perfil se quedaba en
   * `{fetched:false, failed:false}` con sesión abierta: cargando para siempre.
   */
  type Estado = { loading: boolean; failed: boolean; fetched: boolean };
  const EMPTY_S: Estado = { loading: false, failed: false, fetched: false };
  const FAILED_S: Estado = { loading: false, failed: true, fetched: true };
  const OK_S: Estado = { loading: false, failed: false, fetched: true };

  /** El `loading` DERIVADO, tal cual lo calcula el proveedor. */
  const derivado = (s: Estado, auth: boolean) => s.loading || (auth && !s.fetched);

  /**
   * Réplica del orquestador del proveedor: mismo gate, mismo single-flight,
   * y la sesión leída EN EL MOMENTO (como el ref), no capturada.
   */
  function crearProveedor(opts: { autenticado: () => boolean; status: number }) {
    let estado: Estado = { ...EMPTY_S, loading: true };
    let descartados = 0;
    let arranques = 0;
    const gate = createSequenceGate();
    const flight = createSingleFlight();

    const correr = async () => {
      arranques++;
      const seq = gate.begin();
      const publicar = (n: Estado) => {
        if (gate.isCurrent(seq)) estado = n;
        else descartados++;
      };
      // Se lee AHORA, no cuando se creó la función: es el arreglo del closure.
      if (!opts.autenticado()) return void publicar(EMPTY_S);
      estado = { ...estado, loading: true };
      // La red tarda; es lo que abría la ventana de la carrera.
      await new Promise((r) => setTimeout(r, 12));
      publicar(opts.status === 200 ? OK_S : FAILED_S);
    };

    return {
      refresh: () => flight.run(correr),
      ver: () => ({ estado, descartados, arranques, seq: gate.current() }),
    };
  }

  // ── El escenario exacto: autenticado, 200, y cuatro refreshes solapados ──
  {
    const p = crearProveedor({ autenticado: () => true, status: 200 });
    await Promise.all([p.refresh(), p.refresh(), p.refresh(), p.refresh()]);
    const { estado, descartados } = p.ver();

    ok(
      "cuatro refreshes solapados: NINGUNA respuesta buena se descarta",
      descartados === 0,
      `se descartaron ${descartados}`
    );
    ok(
      "y el perfil termina en fetched:true",
      estado.fetched === true && estado.failed === false
    );
    ok(
      "el loading derivado se apaga (no queda cargando eterno)",
      derivado(estado, true) === false
    );
  }

  // ── La regresión concreta: el refresh tardío que creía que no había sesión ──
  {
    // Antes: el 4º refresh entraba con el closure viejo (authenticated=false),
    // publicaba EMPTY y ganaba. Ahora lee la sesión viva, así que no puede.
    let hayLogin = false;
    const p = crearProveedor({ autenticado: () => hayLogin, status: 200 });
    const primero = p.refresh(); // arranca sin sesión
    hayLogin = true; // el login termina a mitad de vuelo (SIWE)
    const segundo = p.refresh(); // el `await refresh()` de wallet-auth
    await Promise.all([primero, segundo]);
    const { estado } = p.ver();

    ok(
      "tras firmar, un refresh tardío YA NO publica EMPTY con sesión abierta",
      !(estado.fetched === false && estado.failed === false),
      `quedó ${JSON.stringify(estado)}`
    );
    ok(
      "y el perfil acaba resuelto, no cargando para siempre",
      derivado(estado, true) === false,
      `quedó ${JSON.stringify(estado)}`
    );
  }

  // ── Barrido: pase lo que pase, nunca se queda en cargando ──
  {
    for (const status of [200, 500]) {
      for (const n of [1, 2, 3, 5, 8]) {
        const p = crearProveedor({ autenticado: () => true, status });
        await Promise.all(Array.from({ length: n }, () => p.refresh()));
        const { estado } = p.ver();
        const resuelto = estado.fetched === true || estado.failed === true;
        if (!resuelto || derivado(estado, true)) {
          ok(`status ${status} con ${n} refreshes solapados`, false,
            `quedó ${JSON.stringify(estado)}`);
        }
      }
    }
    ok(
      "10 combinaciones (200/500 × 1..8 solapados): siempre fetched o failed, nunca cargando",
      true
    );
  }

  // ── Y el single-flight de verdad coalesce ──────────────────────────────
  {
    const p = crearProveedor({ autenticado: () => true, status: 200 });
    await Promise.all([p.refresh(), p.refresh(), p.refresh(), p.refresh()]);
    const { arranques } = p.ver();
    ok(
      "cuatro llamadas solapadas no son cuatro consultas (se coalescen)",
      arranques < 4,
      `arrancaron ${arranques}`
    );
    // Pero la repetición SÍ ocurre: quien pidió datos frescos los recibe.
    ok("y aun así se repite al menos una vez tras la primera", arranques >= 2);
  }

  const ctx = readFileSync(join(ROOT, "lib/profile-context.tsx"), "utf8");
  ok(
    "el proveedor lee la sesión de un ref, no de un closure",
    /const authenticated = authRef\.current;/.test(ctx),
    "con `authenticated` capturado, el refresh tras firmar vuelve a publicar EMPTY"
  );
  ok(
    "y refresh() pasa por el single-flight",
    /flight\.current\.run\(runRefresh\)/.test(ctx),
    "sin coalescer, dos llamadas vuelven a competir por el gate"
  );
  ok(
    "el sequenceGate SIGUE ahí (no se quitó, solo se dejó sin a quién descartar)",
    /sequenceGate\.current\.isCurrent\(sequence\)/.test(ctx),
    "el gate protege del caso legítimo: una respuesta vieja no pisa a una nueva"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
