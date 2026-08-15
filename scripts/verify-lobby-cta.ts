// El botón del lobby, y el caso reproducible que reportó Juan (2026-08-14):
//
//   cerrar sesión → conectar wallet → jugar (funciona) → salirse a mitad →
//   intentar otra vez → ya no arranca → cerrar sesión y reconectar → funciona
//
// Aquí se recorren los TRES momentos con la decisión real (`decideLobbyCta`) y
// se compara qué entrada cambia entre ellos. La conclusión está abajo, en la
// sección 3: jugar CREA una sesión de wallet que antes no existía, y esa sesión
// mueve el botón de un camino que no depende de `/api/profile` a otro que
// depende de él por completo. Cerrar sesión no arregla el perfil: le quita al
// botón la dependencia.
//
// Correr: node scripts/verify-lobby-cta.ts
import { decideLobbyCta, type LobbyCtaInput } from "../lib/lobby-cta.ts";

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/** Todo en verde: wallet puesta, perfil sano, entrada conocida. */
const SANO: LobbyCtaInput = {
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
};

const de = (cambios: Partial<LobbyCtaInput>): LobbyCtaInput => ({
  ...SANO,
  ...cambios,
});

/* ── 1. Que la refactorización no cambió ni una respuesta ───────────────── */

console.log("\n— 1. Las ramas de siempre, una por una —\n");

{
  const casos: Array<[string, Partial<LobbyCtaInput>, string, boolean]> = [
    ["jugada pagada sin registrar", { blockedByPending: true }, "pending", false],
    ["la sesión aún no se sabe", { profileReady: false }, "profile/not-ready", true],
    ["perfil cargando", { authenticated: true, profileLoading: true }, "profile/loading", true],
    ["wagmi reenganchando", { walletReconnecting: true }, "wallet/reconnecting", true],
    ["el perfil falló", { authenticated: true, profileFailed: true }, "profile/failed", false],
    ["con sesión y sin alias", { authenticated: true }, "session/needs-alias", false],
    [
      "con sesión, con alias y wallet puesta",
      { authenticated: true, profileAlias: "PipeRabby" },
      "session/free",
      false,
    ],
    [
      "con sesión pero sin wallet: embebida creándose",
      { authenticated: true, profileAlias: "X", walletConnected: false, embeddedStatus: "creating" },
      "wallet/creating",
      true,
    ],
    [
      "con sesión pero sin wallet: es externa y hay que conectarla",
      { authenticated: true, profileAlias: "X", walletConnected: false, embeddedStatus: "external", canOpenConnectModal: true },
      "wallet/external",
      false,
    ],
    ["solo wallet en MiniPay", {}, "wallet-only/free", false],
    ["solo wallet fuera de MiniPay: hay que firmar", { inMiniPay: false }, "wallet-only/needs-signature", false],
    ["ni sesión ni wallet", { walletConnected: false, embeddedStatus: "idle" }, "no-session", false],
    [
      "contradicción: la embebida dice conectada y el lobby que no",
      { authenticated: true, profileAlias: "X", walletConnected: false, embeddedStatus: "ready" },
      "wallet/ready",
      false,
    ],
    ["la gratis ya se gastó", { freeForDeck: false }, "wallet-only/paid", false],
    ["no se sabe si hay gratis", { entitlementReady: false }, "wallet-only/entitlement", true],
  ];

  for (const [nombre, cambios, razon, deshabilitado] of casos) {
    const r = decideLobbyCta(de(cambios));
    ok(
      `${nombre} → ${razon}${deshabilitado ? " (apagado)" : ""}`,
      r.reason === razon && r.disabled === deshabilitado,
      JSON.stringify(r)
    );
  }
}

/* ── 2. El botón nunca se queda apagado SIN motivo que se resuelva solo ─── */

console.log("\n— 2. Todo botón apagado tiene una causa que se resuelve —\n");

{
  /**
   * Un botón deshabilitado solo es aceptable mientras se espera algo que va a
   * llegar: la sesión, el perfil, el reenganche o la consulta de la entrada.
   * Si sale apagado por cualquier otro motivo, es un callejón sin salida.
   */
  const esperasLegitimas = [
    "profile/not-ready",
    "profile/loading",
    "wallet/reconnecting",
    "wallet/creating",
    "wallet/connecting",
    "wallet/idle-reconnecting",
    "session/entitlement",
    "wallet-only/entitlement",
    "wallet-only/alias-loading",
  ];

  const bool = [false, true];
  const estados = ["idle", "creating", "connecting", "ready", "stuck", "external"] as const;
  let total = 0;
  const culpables = new Set<string>();

  for (const profileReady of bool)
    for (const authenticated of bool)
      for (const profileLoading of bool)
        for (const profileFailed of bool)
          for (const profileAlias of [null, "Pipe"])
            for (const walletConnected of bool)
              for (const walletReconnecting of bool)
                for (const embeddedStatus of estados)
                  for (const inMiniPay of bool)
                    for (const walletAliasReady of bool)
                      for (const walletAlias of [null, "Pipe"])
                        for (const entitlementReady of bool) {
                          total++;
                          const r = decideLobbyCta({
                            blockedByPending: false,
                            profileReady,
                            authenticated,
                            profileLoading,
                            profileFailed,
                            profileAlias,
                            walletConnected,
                            walletReconnecting,
                            embeddedStatus,
                            inMiniPay,
                            canOpenConnectModal: true,
                            walletAliasReady,
                            walletAlias,
                            entitlementReady,
                            freeForDeck: true,
                          });
                          if (r.disabled && !esperasLegitimas.includes(r.reason)) {
                            culpables.add(r.reason);
                          }
                        }

  ok(
    `de ${total} combinaciones, ninguna apaga el botón sin una espera que termine`,
    culpables.size === 0,
    [...culpables].join(", ")
  );
}

/* ── 3. EL CASO REPRODUCIBLE ────────────────────────────────────────────── */

console.log("\n— 3. Conectar → jugar → salirse → volver a intentar —\n");

{
  /**
   * MOMENTO A — wallet recién conectada, todavía sin jugar.
   *
   * No hay sesión de wallet: `ensureWalletSession` solo corre DESPUÉS de una
   * jugada (`lib/pay.ts`). Así que `authenticated` es false y el botón va por
   * el camino "solo wallet", que no consulta `/api/profile` para nada — se
   * apoya en `/api/wallet-alias`.
   */
  const A = de({ authenticated: false });
  const rA = decideLobbyCta(A);
  ok(
    "A · antes de jugar: el botón ofrece jugar",
    rA.action === "start" && !rA.disabled,
    JSON.stringify(rA)
  );
  ok("A · y llega por el camino solo-wallet", rA.reason.startsWith("wallet-only"));

  /**
   * MOMENTO B — jugó y se salió a mitad.
   *
   * La jugada creó la sesión de wallet (`pay.ts:317`,
   * `void ensureWalletSession(account, playHash)`). Eso hace `authenticated`
   * true, y el botón CAMBIA DE CAMINO: ahora depende del perfil.
   *
   * Con el perfil sano no se nota — sigue ofreciendo jugar. El problema es que
   * ahora hay tres estados nuevos en los que antes era imposible caer.
   */
  const B_sano = de({ authenticated: true, profileAlias: "PipeMini" });
  ok(
    "B · si el perfil llega bien, se sigue pudiendo jugar",
    decideLobbyCta(B_sano).action === "start",
    JSON.stringify(decideLobbyCta(B_sano))
  );

  const B_cargando = de({ authenticated: true, profileLoading: true });
  const B_fallo = de({ authenticated: true, profileFailed: true });
  const B_sinAlias = de({ authenticated: true, profileAlias: null });

  ok(
    "B · perfil cargando → botón APAGADO (antes era imposible: no se consultaba)",
    decideLobbyCta(B_cargando).disabled &&
      !decideLobbyCta(de({ authenticated: false, profileLoading: true })).disabled,
    JSON.stringify(decideLobbyCta(B_cargando))
  );
  ok(
    "B · perfil fallido → deja de ofrecer jugar (antes era imposible)",
    decideLobbyCta(B_fallo).action === "reload" &&
      decideLobbyCta(de({ authenticated: false, profileFailed: true })).action === "start",
    JSON.stringify(decideLobbyCta(B_fallo))
  );
  ok(
    "B · perfil sin alias → pide nombre, aunque la WALLET ya tenga el suyo",
    decideLobbyCta(B_sinAlias).action === "access" &&
      decideLobbyCta(de({ authenticated: false, profileAlias: null })).action === "start",
    JSON.stringify(decideLobbyCta(B_sinAlias))
  );

  /**
   * MOMENTO C — cerrar sesión y reconectar la MISMA wallet.
   *
   * `logoutEverything` borra `avispate.wallet-session` (está en
   * `IDENTITY_PREFIXES`), así que `authenticated` vuelve a false y el botón
   * regresa al camino solo-wallet. Por eso "arregla" el problema: no repara el
   * perfil, le quita al botón la dependencia del perfil.
   */
  for (const [nombre, roto] of [
    ["cargando", B_cargando],
    ["fallido", B_fallo],
    ["sin alias", B_sinAlias],
  ] as const) {
    const C = { ...roto, authenticated: false };
    ok(
      `C · con el perfil ${nombre}, cerrar sesión devuelve el botón a "jugar"`,
      decideLobbyCta(C).action === "start" && !decideLobbyCta(C).disabled,
      JSON.stringify(decideLobbyCta(C))
    );
  }

  console.log(
    "\n  → La sesión de wallet que crea la PRIMERA jugada es lo que cambia de\n" +
      "    camino al botón. Con el perfil sano no se nota; con el perfil lento,\n" +
      "    caído o sin alias, el botón muere — y solo el logout lo devuelve,\n" +
      "    porque borra esa sesión.\n"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
