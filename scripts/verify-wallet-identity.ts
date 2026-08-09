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
        profileReady: ready,
        canonical: conCanonica ? RABBY : null,
        hasEmbedded: emb,
        hasExternal: ext,
      }).kind === "create"
  );
  check("de 16 combinaciones, solo una crea", crean.length, 1);
  check("y es la del jugador nuevo", crean[0], [true, false, false, false]);
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
