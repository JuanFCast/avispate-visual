// La sesión de wallet como SEGUNDA fuente de la dirección canónica.
//
// El caso que arregla (Juan, 2026-08-14): conectar una wallet, jugar, salirse a
// mitad, e intentar otra partida — y no poder hasta cerrar sesión y reconectar.
// La causa: cada jugada crea una sesión de wallet (`pay.ts` →
// `ensureWalletSession`), eso pone `authenticated` en true, y a partir de ahí
// tanto el botón como el guardián dependían por completo de `/api/profile`. Si
// el perfil tardaba, fallaba o volvía sin alias, no se podía jugar; el logout
// "arreglaba" el problema solo porque borra esa sesión.
//
// La sesión lleva dentro la dirección que el servidor FIRMÓ después de
// comprobar en la cadena que esa wallet firmó una transacción nuestra. Con eso
// se sabe quién juega sin el perfil — y se sabe MEJOR que antes: donde el
// guardián respondía "no lo sé" (y frenaba) o "no hay canónica" (y dejaba pagar
// a cualquiera), ahora exige esa dirección exacta.
//
// Correr: node scripts/verify-session-canonical.ts
import { canonicalFromProfile } from "../lib/wallet-identity.ts";
import { decidePlayStart } from "../lib/pay-guard.ts";
import { decideLobbyCta, type LobbyCtaInput } from "../lib/lobby-cta.ts";

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/** La wallet del jugador: la que firmó, la que el servidor firmó en la sesión. */
const MIA = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
/** Otra cualquiera. Nunca puede pagar. */
const AJENA = "0x1111111111111111111111111111111111111111";

const contesta = (address: string) =>
  ({ status: "answered", accounts: [address] }) as const;

/** El perfil en cada una de las tres formas de no servir. */
const PERFIL = {
  sano: { ready: true, loading: false, failed: false, authenticated: true, walletAddress: MIA },
  tarda: { ready: true, loading: true, failed: false, authenticated: true, walletAddress: null },
  falla: { ready: true, loading: false, failed: true, authenticated: true, walletAddress: null },
  incompleto: { ready: true, loading: false, failed: false, authenticated: true, walletAddress: null },
  arrancando: { ready: false, loading: true, failed: false, authenticated: true, walletAddress: null },
};

/* ── 1. Las tres variantes: la canónica se sigue sabiendo ───────────────── */

console.log("\n— 1. Con sesión de wallet, la canónica se sabe igual —\n");

for (const [nombre, perfil] of Object.entries(PERFIL)) {
  const c = canonicalFromProfile({ ...perfil, walletSessionAddress: MIA });
  ok(
    `perfil ${nombre} → canónica conocida (${nombre === "sano" ? "del perfil" : "de la sesión"})`,
    c.status === "known" && c.address === MIA,
    JSON.stringify(c)
  );
}

console.log("\n— …y sin sesión de wallet, exactamente lo de antes —\n");

{
  ok(
    "perfil que tarda → sigue siendo 'loading' (frena el cobro)",
    canonicalFromProfile({ ...PERFIL.tarda }).status === "loading"
  );
  ok(
    "perfil que falla → sigue siendo 'loading' (frena el cobro)",
    canonicalFromProfile({ ...PERFIL.falla }).status === "loading"
  );
  ok(
    "sin sesión ninguna → 'none'",
    canonicalFromProfile({
      ready: true, loading: false, failed: false,
      authenticated: false, walletAddress: null,
    }).status === "none"
  );
}

/* ── 2. LA PRUEBA NEGATIVA: otra wallet sigue sin poder pagar ───────────── */

console.log("\n— 2. Si la conectada no es la canónica firmada, NO se paga —\n");

for (const [nombre, perfil] of Object.entries(PERFIL)) {
  const canonical = canonicalFromProfile({ ...perfil, walletSessionAddress: MIA });
  const decision = decidePlayStart({
    expected: AJENA,
    probe: contesta(AJENA),
    pending: null,
    canonical,
  });
  ok(
    `perfil ${nombre} · wallet ajena conectada → bloqueado`,
    decision.kind === "wrong_wallet" &&
      decision.canonical === MIA &&
      decision.connected === AJENA,
    JSON.stringify(decision)
  );
}

{
  // Y el contraste que demuestra que esto APRIETA: con perfil incompleto y sin
  // sesión, el guardián dejaba pagar a cualquiera. Con sesión, ya no.
  const sinSesion = canonicalFromProfile({ ...PERFIL.incompleto });
  const conSesion = canonicalFromProfile({ ...PERFIL.incompleto, walletSessionAddress: MIA });
  const antes = decidePlayStart({ expected: AJENA, probe: contesta(AJENA), pending: null, canonical: sinSesion });
  const ahora = decidePlayStart({ expected: AJENA, probe: contesta(AJENA), pending: null, canonical: conSesion });
  ok(
    "perfil sin dirección: ANTES pagaba cualquiera, AHORA solo la canónica",
    antes.kind === "proceed" && ahora.kind === "wrong_wallet",
    `antes=${antes.kind} ahora=${ahora.kind}`
  );
}

{
  // La jugada pendiente sigue mandando sobre todo lo demás: el candado del
  // segundo cobro no lo toca nada de esto.
  const canonical = canonicalFromProfile({ ...PERFIL.falla, walletSessionAddress: MIA });
  const d = decidePlayStart({
    expected: MIA,
    probe: contesta(MIA),
    pending: { txHash: "0xabc", player: MIA, deckSize: 10 },
    canonical,
  });
  ok("una jugada pagada sin registrar sigue frenando todo", d.kind === "resume_pending");
}

/* ── 3. LA SECUENCIA COMPLETA, sin logout ni recarga ────────────────────── */

console.log("\n— 3. Conectar → jugar → abandonar → volver a jugar —\n");

/** El lobby de un jugador con la wallet puesta y la entrada resuelta. */
const LOBBY: LobbyCtaInput = {
  blockedByPending: false,
  profileReady: true,
  authenticated: false,
  profileLoading: false,
  profileFailed: false,
  profileAlias: null,
  walletConnected: true,
  walletReconnecting: false,
  embeddedStatus: "idle",
  inMiniPay: true,
  canOpenConnectModal: false,
  walletAliasReady: true,
  walletAlias: "PipeMini",
  entitlementReady: true,
  freeForDeck: true,
  walletSessionAddress: null,
};

interface PerfilFalso {
  ready: boolean;
  loading: boolean;
  failed: boolean;
  authenticated: boolean;
  walletAddress: string | null;
}

/** ¿Se puede arrancar una partida AHORA, botón y guardián de acuerdo? */
function sePuedeJugar(lobby: LobbyCtaInput, perfil: PerfilFalso) {
  const cta = decideLobbyCta(lobby);
  const canonical = canonicalFromProfile({
    ...perfil,
    walletSessionAddress: lobby.walletSessionAddress ?? null,
  });
  const guard = decidePlayStart({
    expected: MIA,
    probe: contesta(MIA),
    pending: null,
    canonical,
  });
  return {
    ok: cta.action === "start" && !cta.disabled && guard.kind === "proceed",
    cta,
    guard,
  };
}

for (const entorno of ["MiniPay", "Chrome + Rabby"] as const) {
  console.log(`\n  ·· ${entorno} ··\n`);
  const enMiniPay = entorno === "MiniPay";
  // En Chrome se entra firmando, así que Privy ya dio sesión ANTES de jugar.
  const antesDeJugar: LobbyCtaInput = {
    ...LOBBY,
    inMiniPay: enMiniPay,
    authenticated: !enMiniPay,
    profileAlias: enMiniPay ? null : "PipeRabby",
    walletAlias: enMiniPay ? "PipeMini" : "PipeRabby",
  };

  const paso1 = sePuedeJugar(antesDeJugar, PERFIL.sano);
  ok("1· recién conectada: se puede jugar", paso1.ok, JSON.stringify(paso1.cta));

  /**
   * La jugada crea la sesión de wallet. A partir de aquí `authenticated` es
   * true en los dos entornos y existe la dirección firmada. Se abandona la
   * partida: ni logout, ni recarga, ni reconexión.
   */
  const trasJugar: LobbyCtaInput = {
    ...antesDeJugar,
    authenticated: true,
    walletSessionAddress: MIA,
    // La gratis del día ya se gastó: la siguiente es pagada. Es correcto y no
    // se toca — lo que no puede es impedir jugar.
    freeForDeck: false,
  };

  for (const [nombre, perfil] of [
    ["el perfil llega bien", PERFIL.sano],
    ["el perfil TARDA", PERFIL.tarda],
    ["el perfil FALLA", PERFIL.falla],
    ["el perfil viene INCOMPLETO", PERFIL.incompleto],
    ["Privy ni siquiera arrancó", PERFIL.arrancando],
  ] as const) {
    const estado: LobbyCtaInput = {
      ...trasJugar,
      profileReady: perfil.ready,
      profileLoading: perfil.loading,
      profileFailed: perfil.failed,
      profileAlias: perfil.walletAddress ? antesDeJugar.profileAlias : null,
    };
    const paso2 = sePuedeJugar(estado, perfil);
    ok(
      `2· tras abandonar, ${nombre} → se puede jugar OTRA VEZ`,
      paso2.ok,
      `cta=${JSON.stringify(paso2.cta)} guard=${JSON.stringify(paso2.guard)}`
    );
  }

  // Y con otra wallet conectada, en el peor de los perfiles: sigue bloqueado.
  const conAjena = decidePlayStart({
    expected: AJENA,
    probe: contesta(AJENA),
    pending: null,
    canonical: canonicalFromProfile({ ...PERFIL.falla, walletSessionAddress: MIA }),
  });
  ok("3· pero con otra wallet, el pago sigue bloqueado", conAjena.kind === "wrong_wallet");
}

/* ── 4. Sin sesión de wallet no cambia ni una respuesta ─────────────────── */

console.log("\n— 4. Sin sesión de wallet, el botón se comporta igual que antes —\n");

{
  const sinSesion = { ...LOBBY, authenticated: true, profileAlias: "Pipe" };
  ok(
    "perfil cargando → sigue apagado",
    decideLobbyCta({ ...sinSesion, profileLoading: true }).reason === "profile/loading"
  );
  ok(
    "perfil fallido → sigue ofreciendo reintentar",
    decideLobbyCta({ ...sinSesion, profileFailed: true }).action === "reload"
  );
  ok(
    "perfil sin alias → sigue pidiendo nombre",
    decideLobbyCta({ ...sinSesion, profileAlias: null }).reason === "session/needs-alias"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
