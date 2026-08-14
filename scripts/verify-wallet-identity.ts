// Cuál es TU wallet cuando hay dos candidatas, y qué se puede hacer con la que
// no lo es.
//
// El caso real detrás de esto (PipeRabby, 2026-08-07): entró con la extensión de
// Rabby bloqueada, Privy lo dio por "usuario sin wallets" y le creó una embebida.
// Desde ahí la aplicación tuvo dos direcciones para la misma persona y las
// repartió entre pantallas — estadisticas del perfil (su Rabby, 12 partidas,
// 2.08 USDT) y saldos de la embebida vacia. Mismo perfil, cartera de otro.
//
// Correr: node scripts/verify-wallet-identity.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  canonicalFromProfile,
  decideEmbeddedAutoConnect,
  decideEmbeddedCreation,
  decideWalletIdentity,
  mayTransact,
  SETTLE_LIMIT_MS,
  waitingExpired,
  walletToShow,
} from "../lib/wallet-identity.ts";

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

// Las dos direcciones reales del incidente.
const RABBY = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const EMBED = "0xfd43f6003484579ca068313736632eea8c651477";
const OTRA = "0x1111111111111111111111111111111111111111";

console.log("\n— 1. Solo wallet externa (entro firmando) —");
{
  const v = decideWalletIdentity({ canonical: RABBY, connected: RABBY, ready: true });
  check("la conectada es la canonica", v, { kind: "ok", address: RABBY });
  check("puede operar", mayTransact(v), true);
  check("y la pantalla mira esa", walletToShow(v), RABBY);

  // Mayusculas: la misma wallet escrita distinto sigue siendo la misma.
  check(
    "no se confunde por mayusculas",
    decideWalletIdentity({
      canonical: RABBY,
      connected: RABBY.toUpperCase(),
      ready: true,
    }).kind,
    "ok"
  );
}

console.log("\n— 2. Solo wallet embebida (entro por correo) —");
{
  // Su embebida ES su canonica: no hay ninguna externa que respetar.
  const v = decideWalletIdentity({ canonical: EMBED, connected: EMBED, ready: true });
  check("la embebida manda cuando es la suya", v, { kind: "ok", address: EMBED });
  check("puede operar", mayTransact(v), true);
}

console.log("\n— 3. Jugador nuevo: aun no hay canonica —");
{
  const v = decideWalletIdentity({ canonical: null, connected: EMBED, ready: true });
  check("la conectada sera la suya", v, { kind: "no_canonical", address: EMBED });
  // Si esto bloqueara, nadie podria estrenar cuenta.
  check("puede operar igual", mayTransact(v), true);
  check("y la pantalla mira esa", walletToShow(v), EMBED);
}

console.log("\n— 4. EL CASO PIPERABBY: externa historica + embebida accidental —");
{
  // El perfil tiene la Rabby; wagmi tiene conectada la embebida que Privy creo
  // sola. Antes: estadisticas de una, saldos de la otra.
  const v = decideWalletIdentity({ canonical: RABBY, connected: EMBED, ready: true });
  check("no se cambia de identidad", v, {
    kind: "connect_canonical",
    canonical: RABBY,
    connected: EMBED,
  });

  // Las tres cosas que el bug hacia mal, ahora fijadas:
  check("NO se puede pagar ni cobrar", mayTransact(v), false);
  check("la pantalla ensena la CANONICA, no la conectada", walletToShow(v), RABBY);
  check(
    "y desde luego no ensena la embebida",
    walletToShow(v) === EMBED,
    false
  );
}

console.log("\n— 5. Rabby bloqueada o reconectando —");
{
  // Extension bloqueada: hay canonica y no hay nada conectado.
  const bloqueada = decideWalletIdentity({
    canonical: RABBY,
    connected: null,
    ready: true,
  });
  check("se pide conectar la correcta", bloqueada, {
    kind: "connect_canonical",
    canonical: RABBY,
    connected: null,
  });
  check("sin operar mientras tanto", mayTransact(bloqueada), false);
  // Importante: se sigue viendo SU cartera, no un hueco. El saldo es suyo
  // aunque la extension este dormida.
  check("pero su cartera se sigue viendo", walletToShow(bloqueada), RABBY);

  // Reconectando: todavia no se sabe. Falla cerrado y sin parpadeo de avisos.
  const arrancando = decideWalletIdentity({
    canonical: RABBY,
    connected: null,
    ready: false,
  });
  check("mientras arranca no hay veredicto", arrancando, { kind: "unknown" });
  check("y no autoriza nada", mayTransact(arrancando), false);
  check("ni ensena una direccion a medias", walletToShow(arrancando), null);

  // Ni siquiera con la buena conectada: si no terminamos de mirar, no se sabe.
  check(
    "no se adelanta ni con la correcta puesta",
    decideWalletIdentity({ canonical: RABBY, connected: RABBY, ready: false }).kind,
    "unknown"
  );
}

console.log("\n— 6. Cambio REAL de cuenta —");
{
  // El jugador conecta a proposito otra wallet suya. No se le roba la identidad
  // por eso: sigue mandando la del perfil hasta que el cambio sea deliberado.
  const v = decideWalletIdentity({ canonical: RABBY, connected: OTRA, ready: true });
  check("la identidad no se mueve sola", v.kind, "connect_canonical");
  check("no puede operar con la otra", mayTransact(v), false);
  check("los premios siguen apuntando a la canonica", walletToShow(v), RABBY);

  // Y el reverso: quien vuelve a poner la suya, opera de inmediato.
  check(
    "al reconectar la correcta, todo vuelve",
    mayTransact(decideWalletIdentity({ canonical: RABBY, connected: RABBY, ready: true })),
    true
  );
}

console.log("\n— La regla no depende de la sesion ni de wagmi —");
{
  // Cinco entradas distintas de 'conectada' contra la misma canonica: ninguna
  // que no sea la canonica puede operar. Si algun dia alguien mete una
  // excepcion, esto lo caza.
  const conectadas = [null, EMBED, OTRA, "", "  "];
  const permisos = conectadas.map((c) =>
    mayTransact(decideWalletIdentity({ canonical: RABBY, connected: c, ready: true }))
  );
  check("ninguna ajena opera", permisos, [false, false, false, false, false]);
}

console.log("\n— UNA identidad, UNA wallet: cuando se crea una embebida —");
{
  // La regla estricta: si el perfil ya tiene direccion, NUNCA se crea otra.
  // Ni bloqueada, ni dormida, ni sin responder. Eso se desbloquea, no se
  // sustituye.
  check(
    "PIPERABBY: con canonica no se crea nada",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: RABBY,
      hasEmbedded: false,
      hasExternal: false,
    }),
    { kind: "never", reason: "has_canonical" }
  );

  // Este es el escenario exacto que se pregunto: entra por correo, su Rabby
  // esta solo CONECTADA (no enlazada en Privy), asi que para Privy es un
  // "usuario sin wallets". Antes eso bastaba para provisionarle una.
  check(
    "aunque Privy lo vea como usuario sin wallets",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: RABBY,
      hasEmbedded: false,
      hasExternal: false,
    }).kind,
    "never"
  );

  check(
    "jugador nuevo de verdad: si se le crea",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: null,
      hasEmbedded: false,
      hasExternal: false,
    }),
    { kind: "create" }
  );

  check(
    "ya tiene embebida: no se duplica",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: null,
      hasEmbedded: true,
      hasExternal: false,
    }),
    { kind: "never", reason: "has_embedded" }
  );

  check(
    "entro firmando con la suya: no se le crea otra",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: null,
      hasEmbedded: false,
      hasExternal: true,
    }),
    { kind: "never", reason: "has_external" }
  );

  // Falla CERRADO. Crear de mas es irreversible; esperar cuesta segundos.
  check(
    "sin perfil todavia: NO se crea nada",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: false,
      canonical: null,
      hasEmbedded: false,
      hasExternal: false,
    }),
    { kind: "wait" }
  );
  check(
    "ni siquiera pareciendo un jugador nuevo",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: false,
      canonical: RABBY,
      hasEmbedded: false,
      hasExternal: false,
    }).kind,
    "wait"
  );

  // Un barrido: de todas las combinaciones, solo UNA crea.
  const combos: boolean[][] = [];
  for (const ready of [true, false])
    for (const conCanonica of [true, false])
      for (const emb of [true, false])
        for (const ext of [true, false]) combos.push([ready, conCanonica, emb, ext]);
  const crean = combos.filter(
    ([ready, conCanonica, emb, ext]) =>
      decideEmbeddedCreation({
        inMiniPay: false,
        profileReady: ready,
        canonical: conCanonica ? RABBY : null,
        hasEmbedded: emb,
        hasExternal: ext,
      }).kind === "create"
  );
  check("de 16 combinaciones, solo una crea", crean.length, 1);
  check("y es la del jugador nuevo", crean[0], [true, false, false, false]);
}

console.log("\n— DENTRO de MiniPay no se crea una embebida. Nunca. —");
{
  // El jugador ya tiene wallet: la inyectada. Crearle otra seria el caso
  // PipeRabby pero dentro de MiniPay — dos identidades en el mismo entorno.
  const enMiniPay = {
    inMiniPay: true,
    profileReady: true,
    canonical: null,
    hasEmbedded: false,
    hasExternal: false,
  };

  check("MiniPay + inyectada + sin perfil", decideEmbeddedCreation(enMiniPay), {
    kind: "never",
    reason: "minipay",
  });

  // El caso que la regla del perfil NO cubria: Privy ve un "usuario sin
  // wallets" porque la inyectada no esta enlazada a su cuenta, y le
  // provisionaria una. `loginMethods` incluye email, asi que es alcanzable.
  check(
    "MiniPay + inyectada + login por correo (sin nada enlazado)",
    decideEmbeddedCreation({ ...enMiniPay, hasEmbedded: false, hasExternal: false }),
    { kind: "never", reason: "minipay" }
  );

  check(
    "MiniPay + inyectada + perfil existente",
    decideEmbeddedCreation({ ...enMiniPay, canonical: RABBY }),
    { kind: "never", reason: "minipay" }
  );

  // No espera al perfil: este camino solo puede NEGAR, nunca autorizar, asi
  // que adelantarse es seguro.
  check(
    "y ni siquiera espera al perfil",
    decideEmbeddedCreation({ ...enMiniPay, profileReady: false }),
    { kind: "never", reason: "minipay" }
  );

  // Barrido: dentro de MiniPay, NINGUNA combinacion crea.
  const dentro: string[] = [];
  for (const ready of [true, false])
    for (const conCanonica of [true, false])
      for (const emb of [true, false])
        for (const ext of [true, false])
          dentro.push(
            decideEmbeddedCreation({
              inMiniPay: true,
              profileReady: ready,
              canonical: conCanonica ? RABBY : null,
              hasEmbedded: emb,
              hasExternal: ext,
            }).kind
          );
  check("las 16 combinaciones dicen 'never'", new Set(dentro), new Set(["never"]));
}

console.log("\n— Y FUERA de MiniPay nada cambia —");
{
  // La regla es especifica de MiniPay: Rabby, MetaMask y el correo en web
  // siguen exactamente como estaban.
  check(
    "web: el jugador nuevo SIGUE recibiendo su embebida",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: null,
      hasEmbedded: false,
      hasExternal: false,
    }),
    { kind: "create" }
  );
  check(
    "web + wallet externa: intacto",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: null,
      hasEmbedded: false,
      hasExternal: true,
    }),
    { kind: "never", reason: "has_external" }
  );
  check(
    "web + canonica: intacto",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: RABBY,
      hasEmbedded: false,
      hasExternal: false,
    }),
    { kind: "never", reason: "has_canonical" }
  );
  check(
    "web + ya tiene embebida: intacto",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: true,
      canonical: null,
      hasEmbedded: true,
      hasExternal: false,
    }),
    { kind: "never", reason: "has_embedded" }
  );
  check(
    "web + perfil sin llegar: sigue esperando",
    decideEmbeddedCreation({
      inMiniPay: false,
      profileReady: false,
      canonical: null,
      hasEmbedded: false,
      hasExternal: false,
    }),
    { kind: "wait" }
  );

  const proveedor = readFileSync(join(ROOT, "lib/embedded-wallet.tsx"), "utf8");
  check("el proveedor pasa si estamos en MiniPay", /inMiniPay,/.test(proveedor), true);
  check(
    "y lo saca de la deteccion de siempre",
    /useIsMiniPay\(\)/.test(proveedor),
    true
  );
}

console.log("\n— Esperar esta bien; esperar SIN TOPE es un cuelgue —");
{
  // El sintoma real: sesion cerrada y el lobby en "Preparando..." para siempre.
  // Pasa cuando wagmi reintenta un conector que ya no puede existir — la
  // embebida solo se anuncia por EIP-6963 mientras hay sesion de Privy.
  check("no se espera si no se esta esperando", waitingExpired(null, 10_000), false);
  check("recien empezado: se espera", waitingExpired(1_000, 1_500), false);
  check("justo antes del tope: se espera", waitingExpired(0, SETTLE_LIMIT_MS - 1), false);
  check("en el tope: se deja de esperar", waitingExpired(0, SETTLE_LIMIT_MS), true);
  check("pasado el tope: se deja de esperar", waitingExpired(0, SETTLE_LIMIT_MS + 5_000), true);
  // Un tope de verdad, no uno tan largo que no sirva.
  check("el tope es humano", SETTLE_LIMIT_MS <= 10_000 && SETTLE_LIMIT_MS >= 2_000, true);

  const wallet = readFileSync(join(ROOT, "lib/wallet.ts"), "utf8");
  check(
    "el reenganche de wagmi caduca",
    /waitingExpired\(desde\.current/.test(wallet),
    true
  );
  const perfilCtx = readFileSync(join(ROOT, "lib/profile-context.tsx"), "utf8");
  check(
    "y la espera a Privy tambien",
    /privyReady \|\| privyTimedOut/.test(perfilCtx),
    true
  );
}

console.log("\n— Un perfil que NO cargo no es un perfil vacio —");
{
  // El caso que se vio en produccion: `refresh()` hacia `catch { setState(EMPTY) }`
  // y EMPTY es `alias: null, walletAddress: null`. Como `authenticated` se
  // calcula aparte y seguia en true, un fallo de carga quedaba indistinguible
  // de "jugador nuevo sin nada": se le pedia alias a quien ya tenia el suyo, y
  // de paso el guardian de pago se apagaba.
  const cargado = {
    ready: true,
    loading: false,
    failed: false,
    authenticated: true,
    walletAddress: RABBY,
  };

  check("perfil cargado: se sabe cual es", canonicalFromProfile(cargado), {
    status: "known",
    address: RABBY,
  });

  check(
    "perfil que FALLO: no se sabe, no se autoriza",
    canonicalFromProfile({ ...cargado, failed: true, walletAddress: null }),
    { status: "loading" }
  );

  check(
    "perfil cargando: tampoco se sabe",
    canonicalFromProfile({ ...cargado, loading: true, walletAddress: null }),
    { status: "loading" }
  );

  // Y la distincion que importa: sin sesion SI se sabe que no hay perfil, y un
  // jugador nuevo autenticado SI puede estrenar wallet. `none` no es `loading`.
  check(
    "sin sesion: se sabe que no hay",
    canonicalFromProfile({ ...cargado, authenticated: false, walletAddress: null }),
    { status: "none" }
  );
  check(
    "jugador nuevo con sesion: se sabe que aun no tiene",
    canonicalFromProfile({ ...cargado, walletAddress: null }),
    { status: "none" }
  );
  check(
    "todavia arrancando: no se sabe",
    canonicalFromProfile({ ...cargado, ready: false }),
    { status: "loading" }
  );

  // El fallo NO puede colarse como "no tiene wallet" por ninguna combinacion.
  const conFallo = [true, false].flatMap((loading) =>
    [RABBY, null].map((w) =>
      canonicalFromProfile({ ...cargado, failed: true, loading, walletAddress: w })
    )
  );
  check(
    "con fallo, siempre 'no lo se'",
    conFallo.every((v) => v.status === "loading"),
    true
  );

  // ── La ventana de UN render entre firmar y pedir el perfil ──────────────
  //
  // Al firmar, `authenticated` pasa a true en el acto; el estado del perfil
  // sigue siendo el vacio de cuando no habia sesion, con `loading: false`. Ese
  // render decia "autenticado + termino de cargar + sin alias" = jugador nuevo,
  // y de ahi el parpadeo del formulario de alias. `refresh` corre en un efecto,
  // o sea despues de pintar, asi que no llega a tiempo de evitarlo.
  const reciénFirmado = {
    ready: true,
    loading: false, // <- lo que traia el estado de antes de la sesion
    failed: false,
    authenticated: true,
    walletAddress: null,
  };
  check(
    "sin `fetched`, ese render parecia jugador nuevo",
    canonicalFromProfile(reciénFirmado),
    { status: "none" }
  );
  // Con `fetched` en falso, `loading` se deriva true y el render dice "no lo se".
  check(
    "con el estado marcado como no traido, no se sabe",
    canonicalFromProfile({ ...reciénFirmado, loading: true }),
    { status: "loading" }
  );

  const ctx = readFileSync(join(ROOT, "lib/profile-context.tsx"), "utf8");
  check(
    "el perfil sabe si corresponde a esta sesion",
    /fetched: boolean/.test(ctx),
    true
  );
  check(
    "y 'cargando' incluye el hueco de firmar",
    /state\.loading \|\| \(authenticated && !state\.fetched\)/.test(ctx),
    true
  );
  check(
    "el fallo no se queda cargando para siempre",
    /failed: true, fetched: true/.test(ctx),
    true
  );
  check("el fallo se guarda como tal", /const FAILED: ProfileState/.test(ctx), true);
  check(
    "y el catch ya no lo guarda como vacio",
    /catch \{\s*setState\(EMPTY\);/.test(ctx),
    false
  );
  const lobby2 = readFileSync(join(ROOT, "components/lobby/HomeLobby.tsx"), "utf8");
  check(
    "el lobby ofrece reintentar en vez de pedir alias",
    /profile\.authenticated && profile\.failed/.test(lobby2),
    true
  );
}

console.log("\n— Auto-conectar la embebida: cuándo SÍ y cuándo NO —");
{
  // El caso real, con nombre: perfil con Rabby canónica, la embebida vieja de
  // 2026-08-07 sigue enlazada en Privy. No debe ganar la carrera de wagmi.
  check(
    "PIPERABBY: canónica externa distinta a la embebida → no se conecta sola",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "known", address: RABBY },
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "skip", reason: "canonical_elsewhere" }
  );

  check(
    "la embebida ES la canónica (usuario solo-correo) → sí se conecta",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "known", address: EMBED },
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "connect" }
  );

  check(
    "jugador nuevo de verdad, sin nada enlazado → sí se conecta",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "none" },
      embeddedAddress: null,
      hasExternal: false,
      hasEmbedded: false,
    }),
    { kind: "connect" }
  );

  check(
    "jugador nuevo con su embebida YA creada, perfil sin canónica todavía → se conecta",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "none" },
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "connect" }
  );

  check(
    "entró firmando con la suya, nunca hubo embebida → salta, no espera",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "none" },
      embeddedAddress: null,
      hasExternal: true,
      hasEmbedded: false,
    }),
    { kind: "skip", reason: "has_external" }
  );

  console.log("\n  — Protección 1: perfil sin resolver (falló, timeout, reintentando) —");

  check(
    "perfil todavía cargando → espera, no se adelanta",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "loading" },
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "wait" }
  );

  // Compuesto con `canonicalFromProfile`, igual que lo vería el componente
  // real: un perfil que FALLÓ (timeout de `fetchProfileWithTimeout`, red caída,
  // 500) no puede colarse como "sin canónica" y dejar pasar la conexión.
  check(
    "perfil que FALLÓ (timeout o error de red) → sigue esperando, no 'none'",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: canonicalFromProfile({
        ready: true,
        loading: false,
        failed: true,
        authenticated: true,
        walletAddress: null,
      }),
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "wait" }
  );

  check(
    "perfil recuperándose (loading:true a mitad de un refresh) → sigue esperando",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: canonicalFromProfile({
        ready: true,
        loading: true,
        failed: false,
        authenticated: true,
        walletAddress: RABBY, // el valor viejo en caché no cuenta mientras carga
      }),
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "wait" }
  );

  check(
    "Privy sin terminar de arrancar (`ready:false`) → sigue esperando",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: canonicalFromProfile({
        ready: false,
        loading: false,
        failed: false,
        authenticated: true,
        walletAddress: null,
      }),
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "wait" }
  );

  console.log("\n  — Protección 2: externa Y embebida enlazadas, sin canónica todavía —");

  // El caso que se pidió revisar explícitamente: dos wallets enlazadas a la
  // misma identidad y el perfil todavía no dice cuál es la canónica. La
  // embebida NO puede ganar por defecto solo porque llegó primero a
  // `useWallets()` — es la misma ambigüedad que resolvió `privy-server.ts`
  // ("la externa se elige primero"), aplicada también aquí.
  check(
    "externa Y embebida enlazadas, sin canónica → ambiguo, NO se conecta sola",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "none" },
      embeddedAddress: EMBED,
      hasExternal: true,
      hasEmbedded: true,
    }),
    { kind: "skip", reason: "ambiguous_identity" }
  );

  // Pero si el PERFIL ya zanjó la ambigüedad —la canónica es justo esta
  // embebida, aunque también haya una externa enlazada por curiosidad—, la
  // fuente que manda gana y sí se conecta.
  check(
    "externa Y embebida enlazadas, pero el perfil dice que la canónica ES la embebida → se conecta",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "known", address: EMBED },
      embeddedAddress: EMBED,
      hasExternal: true,
      hasEmbedded: true,
    }),
    { kind: "connect" }
  );

  // Y si el perfil dice que la canónica es la OTRA externa (ni la embebida ni
  // la enlazada de Privy), tampoco se conecta.
  check(
    "externa Y embebida enlazadas, canónica es una tercera dirección → no se conecta",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "known", address: OTRA },
      embeddedAddress: EMBED,
      hasExternal: true,
      hasEmbedded: true,
    }),
    { kind: "skip", reason: "ambiguous_identity" }
  );

  console.log("\n  — Protección 3: dentro de MiniPay, la inyectada manda SIEMPRE —");

  // El bug que volvió, ahora dentro de MiniPay: la MISMA cuenta de correo
  // enlazada en un navegador normal (con su embebida) y abierta también en
  // MiniPay (con la inyectada) hace que `hasEmbedded` sea `true` ahí también.
  // Sin este chequeo, si la canónica coincidía con esa embebida, el efecto de
  // aquí y `MiniPayBridge` competían por conectar cada uno la suya.
  check(
    "MiniPay + embebida enlazada + canónica ES la embebida → NUNCA se conecta la embebida",
    decideEmbeddedAutoConnect({
      inMiniPay: true,
      canonical: { status: "known", address: EMBED },
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "skip", reason: "minipay" }
  );

  check(
    "MiniPay + sin canónica todavía (jugador nuevo en MiniPay) → tampoco",
    decideEmbeddedAutoConnect({
      inMiniPay: true,
      canonical: { status: "none" },
      embeddedAddress: null,
      hasExternal: false,
      hasEmbedded: false,
    }),
    { kind: "skip", reason: "minipay" }
  );

  check(
    "MiniPay + perfil todavía cargando → tampoco espera, salta directo",
    decideEmbeddedAutoConnect({
      inMiniPay: true,
      canonical: { status: "loading" },
      embeddedAddress: EMBED,
      hasExternal: true,
      hasEmbedded: true,
    }),
    { kind: "skip", reason: "minipay" }
  );

  // Barrido: dentro de MiniPay, NINGUNA combinación de canónica/externa/
  // embebida devuelve "connect". La inyectada de MiniPay es la única wallet
  // real ahí dentro, sin excepción — igual que ya exige `decideEmbeddedCreation`.
  {
    const combos: string[] = [];
    for (const canon of [
      { status: "none" as const },
      { status: "loading" as const },
      { status: "known" as const, address: EMBED },
      { status: "known" as const, address: RABBY },
    ])
      for (const ext of [true, false])
        for (const emb of [true, false])
          combos.push(
            decideEmbeddedAutoConnect({
              inMiniPay: true,
              canonical: canon,
              embeddedAddress: EMBED,
              hasExternal: ext,
              hasEmbedded: emb,
            }).kind
          );
    check(
      "dentro de MiniPay: nunca 'connect', en ninguna de las 16 combinaciones",
      new Set(combos),
      new Set(["skip"])
    );
  }

  console.log("\n  — Detalles —");

  check(
    "no se confunde por mayúsculas en la dirección",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "known", address: EMBED.toUpperCase() },
      embeddedAddress: EMBED,
      hasExternal: false,
      hasEmbedded: true,
    }).kind,
    "connect"
  );

  check(
    "canónica conocida pero la embebida de esta sesión aún no llegó (null) → no se conecta",
    decideEmbeddedAutoConnect({
      inMiniPay: false,
      canonical: { status: "known", address: EMBED },
      embeddedAddress: null,
      hasExternal: false,
      hasEmbedded: true,
    }),
    { kind: "skip", reason: "canonical_elsewhere" }
  );

  // Barrido: con canónica CONOCIDA y distinta de la embebida, jamás sale
  // "connect", pase lo que pase con hasExternal/hasEmbedded.
  {
    const combos: string[] = [];
    for (const ext of [true, false])
      for (const emb of [true, false])
        combos.push(
          decideEmbeddedAutoConnect({
            inMiniPay: false,
            canonical: { status: "known", address: RABBY },
            embeddedAddress: EMBED,
            hasExternal: ext,
            hasEmbedded: emb,
          }).kind
        );
    check(
      "canónica ajena: nunca 'connect', pase lo que pase con hasExternal/hasEmbedded",
      combos.every((k) => k !== "connect"),
      true
    );
  }

  // Barrido: mientras el perfil no resuelva ('loading'), jamás sale "connect"
  // salvo que la externa ya la haya descartado con un 'skip' más fuerte —y en
  // ese caso da igual, el resultado sigue sin ser "connect".
  {
    const combos: string[] = [];
    for (const ext of [true, false])
      for (const emb of [true, false])
        combos.push(
          decideEmbeddedAutoConnect({
            inMiniPay: false,
            canonical: { status: "loading" },
            embeddedAddress: EMBED,
            hasExternal: ext,
            hasEmbedded: emb,
          }).kind
        );
    check(
      "perfil sin resolver: nunca 'connect', pase lo que pase",
      combos.every((k) => k !== "connect"),
      true
    );
  }
}

console.log("\n— Y esta enchufada donde importa —");
{
  const perfil = readFileSync(join(ROOT, "app/perfil/page.tsx"), "utf8");
  check(
    "el perfil ya no pasa la wallet conectada a la tarjeta",
    /<WalletCard address=\{address\}/.test(perfil),
    false
  );
  check(
    "usa la que manda la regla",
    /walletToShow|shownWallet/.test(perfil),
    true
  );

  const embebida = readFileSync(join(ROOT, "lib/embedded-wallet.tsx"), "utf8");
  check(
    "el listener de proveedores se quita al limpiar",
    /removeEventListener\("eip6963:requestProvider"/.test(embebida),
    true
  );
  check(
    "el auto-conectar pasa por la regla nueva",
    /decideEmbeddedAutoConnect\(\{/.test(embebida),
    true
  );
  check(
    "y de verdad frena el connect() cuando la regla no dice 'connect'",
    /if \(autoConnect\.kind !== "connect"\) return;/.test(embebida),
    true
  );
  check(
    "ya no queda el criterio viejo (solo Privy, sin mirar el perfil)",
    /const externalOnly = hasExternal && !hasEmbedded;/.test(embebida),
    false
  );
  check(
    // El reenganche NATIVO de wagmi (`reconnectOnMount`) es independiente de
    // nuestro `connect()` y puede restaurar la embebida sin pasar por la
    // regla. Sin esto, un navegador que quedó conectado a ella en cualquier
    // sesión ANTES de este arreglo la reengancha sola en cada carga.
    "existe el efecto que suelta la embebida si wagmi la reenganchó solo",
    /useDisconnect\(\)/.test(embebida),
    true
  );
  check(
    "y solo la suelta cuando la regla dice 'skip'",
    /if \(autoConnect\.kind !== "skip"\) return;/.test(embebida),
    true
  );
  check(
    "sin tocar jamás una wallet que NO sea la embebida",
    /!== embeddedAddress\.toLowerCase\(\)\) return;/.test(embebida),
    true
  );
  check(
    "y la llamada real le pasa inMiniPay, no solo los scripts de prueba",
    /decideEmbeddedAutoConnect\(\{\s*inMiniPay,/.test(embebida),
    true
  );

  /*
   * Y el guardián tiene que tener SALIDA en los dos sitios que cobran.
   *
   * El reto diario siempre la tuvo (`lobby-block` con "Cambiar o conectar
   * billetera"); la Arena pintaba el mismo aviso como texto suelto y sin un
   * solo botón que permitiera conectar la billetera que el propio mensaje
   * pedía. Misma cuenta, mismo bloqueo: recuperable desde la portada e
   * imposible desde la Arena. Un aviso sin salida no es una protección, es un
   * callejón — y es lo que impedía pagar la entrada de 0.10.
   */
  const arenaPago = readFileSync(
    join(ROOT, "components/arena/ArenaSeatPayment.tsx"),
    "utf8"
  );
  check(
    "la pantalla de pago de la Arena puede abrir el selector de wallets",
    /ConnectModalBridge/.test(arenaPago),
    true
  );
  check(
    "pero NUNCA dentro de MiniPay",
    /!inMiniPay && <ConnectModalBridge/.test(arenaPago),
    true
  );
  check(
    "reconoce los tres avisos que se arreglan con la billetera",
    ["pay.block.wrong_wallet", "pay.block.reconnect", "pay.block.account_changed"]
      .every((k) => arenaPago.includes(k)),
    true
  );
  check(
    "y ofrece el botón cuando el bloqueo es de billetera",
    /walletBlocked && !busy/.test(arenaPago) &&
      /pay\.action\.connect/.test(arenaPago),
    true
  );

  // El invariante, no la forma: la EXTERNA se elige primero. Comprobar que ya
  // no existe el patron viejo no serviria — es subcadena del nuevo, porque la
  // embebida sigue siendo el segundo recurso para quien solo entro por correo.
  // Las dos vias de creacion que decidian a ciegas.
  const providers = readFileSync(join(ROOT, "lib/wallet-providers.tsx"), "utf8");
  check(
    "Privy ya no crea wallets por su cuenta al entrar",
    /createOnLogin: "users-without-wallets"/.test(providers),
    false
  );
  check("createOnLogin apagado", /createOnLogin: "off"/.test(providers), true);
  // El perfil tiene que envolver a la embebida, o la decision se toma a ciegas.
  check(
    "el perfil envuelve a la wallet embebida",
    /<ProfileProvider>[\s\S]*<EmbeddedWalletProvider>/.test(providers),
    true
  );
  check(
    "la creacion pasa por la regla",
    /decideEmbeddedCreation\(\{/.test(embebida) &&
      /creation\.kind !== "create"/.test(embebida),
    true
  );

  const servidor = readFileSync(join(ROOT, "lib/privy-server.ts"), "utf8");
  check(
    "el servidor prefiere la wallet EXTERNA del jugador",
    /const wallet = externa \?\?/.test(servidor),
    true
  );
  check(
    "y la externa se identifica por no ser de Privy",
    /walletClientType !== "privy"/.test(servidor),
    true
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobacion(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
