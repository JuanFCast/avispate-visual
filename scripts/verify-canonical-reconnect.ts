// Reenganchar la wallet canónica externa al cargar (el caso PipeRabby: correo +
// Rabby canónica + una embebida de arrastre, que al soltarse dejaba el lobby
// pidiendo "conecta tu billetera" en cada visita).
//
// Lo que se comprueba aquí no es que funcione, es que no regale nada:
//
//   1. nunca se cambia solo a una wallet distinta de la canónica;
//   2. no se reengancha si no se puede DEMOSTRAR que el conector es la canónica;
//   3. jamás se toca una wallet que ya está puesta;
//   4. MiniPay y la embebida siguen mandando en su terreno;
//   5. y los tres decisores no pueden querer conectar a la vez — se recorren
//      TODAS las combinaciones de entradas, no una muestra.
//
// Correr: node scripts/verify-canonical-reconnect.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideCanonicalReconnect,
  decideEmbeddedAutoConnect,
  pickCanonicalConnector,
  EMBEDDED_WALLET_NAME,
  type ProbedConnector,
} from "../lib/wallet-identity.ts";
import type { CanonicalWallet } from "../lib/pay-guard.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

const RABBY = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const EMBEBIDA = "0xfd43f60000000000000000000000000000001477";
const OTRA = "0x1111111111111111111111111111111111111111";

/** El caso PipeRabby, tal cual: sesión de correo, canónica en Rabby. */
const pipeRabby = {
  inMiniPay: false,
  authenticated: true,
  isConnected: false,
  reconnecting: false,
  canonical: { status: "known", address: RABBY } as CanonicalWallet,
  embeddedAddress: EMBEBIDA,
};

/* ── 1. El caso que se quiere arreglar ──────────────────────────────────── */

console.log("\n— 1. PipeRabby: canónica en Rabby y nada conectado —\n");

{
  const d = decideCanonicalReconnect(pipeRabby);
  ok(
    "se puede preguntar en silencio por la canónica",
    d.kind === "probe" && d.canonical === RABBY,
    JSON.stringify(d)
  );
}

{
  // Rabby contesta con su cuenta seleccionada, que es la canónica.
  const probed: ProbedConnector[] = [
    { id: "rabby", name: "Rabby", accounts: [RABBY] },
    { id: "io.metamask", name: "MetaMask", accounts: [] },
  ];
  ok(
    "se elige el conector que DEMUESTRA ser la canónica",
    pickCanonicalConnector(RABBY, probed) === "rabby"
  );
  ok(
    "y da igual cómo esté escrita la dirección",
    pickCanonicalConnector(RABBY.toUpperCase(), probed) === "rabby"
  );
}

/* ── 2. Lo que NO se puede demostrar, no se reengancha ──────────────────── */

console.log("\n— 2. Sin prueba no hay reenganche: se pide conexión manual —\n");

{
  ok(
    "extensión bloqueada (lista vacía): nadie es elegido",
    pickCanonicalConnector(RABBY, [
      { id: "rabby", name: "Rabby", accounts: [] },
    ]) === null
  );
  ok(
    "sin permiso para el sitio: nadie es elegido",
    pickCanonicalConnector(RABBY, []) === null
  );
  ok(
    "otra wallet autorizada que NO es la canónica: nadie es elegido",
    pickCanonicalConnector(RABBY, [
      { id: "io.metamask", name: "MetaMask", accounts: [OTRA] },
    ]) === null
  );

  /**
   * El caso fino, y la razón de exigir la PRIMERA cuenta y no "que esté".
   * wagmi deja activa `accounts[0]`: si la canónica va segunda, reenganchar
   * dejaría puesta otra dirección. Eso es cambiar de wallet solo, y no se hace.
   */
  ok(
    "canónica autorizada pero NO seleccionada: tampoco se reengancha",
    pickCanonicalConnector(RABBY, [
      { id: "rabby", name: "Rabby", accounts: [OTRA, RABBY] },
    ]) === null,
    "reenganchar aquí dejaría activa " + OTRA
  );
}

/* ── 3. La embebida no compite en este terreno ──────────────────────────── */

console.log("\n— 3. La embebida nunca la elige este decisor —\n");

{
  ok(
    "aunque la embebida sea justo la dirección buscada, se salta",
    pickCanonicalConnector(EMBEBIDA, [
      { id: "fun.avispate.embedded", name: EMBEDDED_WALLET_NAME, accounts: [EMBEBIDA] },
    ]) === null,
    "de la embebida se encarga decideEmbeddedAutoConnect, no esto"
  );
  ok(
    "y si la canónica ES la embebida, ni se pregunta",
    decideCanonicalReconnect({ ...pipeRabby, canonical: { status: "known", address: EMBEBIDA } })
      .kind === "skip"
  );
}

/* ── 4. Nunca se pisa una wallet ya puesta, ni se corre sin saber ───────── */

console.log("\n— 4. Cuándo NO toca hacer nada —\n");

{
  const casos: Array<[string, Parameters<typeof decideCanonicalReconnect>[0], string]> = [
    ["ya hay una wallet conectada", { ...pipeRabby, isConnected: true }, "skip"],
    ["dentro de MiniPay", { ...pipeRabby, inMiniPay: true }, "skip"],
    ["sin sesión", { ...pipeRabby, authenticated: false }, "skip"],
    ["el perfil no tiene wallet anotada", { ...pipeRabby, canonical: { status: "none" } }, "skip"],
    ["el perfil todavía carga", { ...pipeRabby, canonical: { status: "loading" } }, "wait"],
    ["wagmi sigue reenganchando por su cuenta", { ...pipeRabby, reconnecting: true }, "wait"],
  ];
  for (const [nombre, entrada, esperado] of casos) {
    const d = decideCanonicalReconnect(entrada);
    ok(`${nombre} → ${esperado}`, d.kind === esperado, JSON.stringify(d));
  }

  // MiniPay manda incluso sobre todo lo demás a la vez.
  ok(
    "MiniPay gana aunque el resto invite a reenganchar",
    decideCanonicalReconnect({ ...pipeRabby, inMiniPay: true }).kind === "skip" &&
      (decideCanonicalReconnect({ ...pipeRabby, inMiniPay: true }) as { reason: string })
        .reason === "minipay"
  );
}

/* ── 5. Los tres decisores no pueden pelearse. TODAS las combinaciones ──── */

console.log("\n— 5. Exhaustivo: nunca dos decisores queriendo conectar —\n");

{
  const canonicas: CanonicalWallet[] = [
    { status: "loading" },
    { status: "none" },
    { status: "known", address: RABBY },
    { status: "known", address: EMBEBIDA },
  ];
  const direcciones = [null, EMBEBIDA];
  const bool = [false, true];

  let combinaciones = 0;
  let choques = 0;
  let ejemplo = "";

  for (const inMiniPay of bool)
    for (const authenticated of bool)
      for (const isConnected of bool)
        for (const reconnecting of bool)
          for (const canonical of canonicas)
            for (const embeddedAddress of direcciones)
              for (const hasExternal of bool)
                for (const hasEmbedded of bool) {
                  combinaciones++;

                  const externa = decideCanonicalReconnect({
                    inMiniPay,
                    authenticated,
                    isConnected,
                    reconnecting,
                    canonical,
                    embeddedAddress,
                  });
                  const embebida = decideEmbeddedAutoConnect({
                    inMiniPay,
                    canonical,
                    embeddedAddress,
                    hasExternal,
                    hasEmbedded,
                  });

                  // El choque sería: uno quiere reenganchar la externa y el
                  // otro quiere conectar la embebida, a la vez.
                  if (externa.kind === "probe" && embebida.kind === "connect") {
                    choques++;
                    if (!ejemplo)
                      ejemplo = JSON.stringify({
                        inMiniPay, authenticated, isConnected, reconnecting,
                        canonical, embeddedAddress, hasExternal, hasEmbedded,
                      });
                  }
                }

  ok(
    `ninguna de las ${combinaciones} combinaciones hace que los dos quieran conectar`,
    choques === 0,
    `${choques} choques, p. ej. ${ejemplo}`
  );

  // Y dentro de MiniPay no actúa NINGUNO de los dos: manda la inyectada.
  let enMiniPay = 0;
  for (const canonical of canonicas)
    for (const embeddedAddress of direcciones)
      for (const hasExternal of bool)
        for (const hasEmbedded of bool) {
          const a = decideCanonicalReconnect({
            inMiniPay: true, authenticated: true, isConnected: false,
            reconnecting: false, canonical, embeddedAddress,
          });
          const b = decideEmbeddedAutoConnect({
            inMiniPay: true, canonical, embeddedAddress, hasExternal, hasEmbedded,
          });
          if (a.kind !== "skip" || b.kind !== "skip") enMiniPay++;
        }
  ok(
    "dentro de MiniPay los dos se apagan siempre, en todas las combinaciones",
    enMiniPay === 0,
    `${enMiniPay} casos en los que alguno actuaría dentro de MiniPay`
  );
}

/* ── 6. El código real usa la primitiva silenciosa, no la que pregunta ──── */

console.log("\n— 6. Reconectar sin abrir ventanas: `reconnect`, nunca `connect` —\n");

{
  const fuente = readFileSync(join(ROOT, "lib/canonical-reconnect.ts"), "utf8")
    .replace(/\r\n/g, "\n");

  /**
   * La diferencia entera está aquí. `reconnect()` de wagmi entra por
   * `connect({ isReconnecting: true })`, y ese camino NO llama a
   * `eth_requestAccounts` (`@wagmi/core/connectors/injected.js`: el
   * `if (!accounts?.length && !isReconnecting)` lo impide). `connect()` a secas
   * sí abre la ventana de la extensión.
   */
  ok(
    "se llama a `reconnect`, que no abre ventanas",
    /reconnectRef\.current\(\{ connectors: \[connector\] \}\)/.test(fuente)
  );
  ok(
    "y NO se llama a `connect(` en ninguna parte de este archivo",
    !/[^e]connect\(\{\s*connector/.test(fuente),
    fuente
  );
  ok(
    "se pregunta con `probeWallet`, que acaba en eth_accounts",
    /await probeWallet\(c\)/.test(fuente)
  );
  ok(
    "los conectores de sesión remota quedan fuera (solo inyectados)",
    /c\.type === "injected" && c\.name !== EMBEDDED_WALLET_NAME/.test(fuente)
  );
  ok(
    "la elección la hace `pickCanonicalConnector`, no un `if` a mano",
    /pickCanonicalConnector\(decision\.canonical, probed\)/.test(fuente)
  );
  ok(
    "si no hay elegido, se sale sin tocar nada",
    /if \(!elegido\) return;/.test(fuente)
  );
  ok(
    "no se firma ni se paga desde aquí",
    !/signMessage|writeContract|sendTransaction|playForDeck/.test(fuente)
  );

  /**
   * Y la trampa que ya costó un día en el anuncio EIP-6963: si el efecto
   * depende del OBJETO `profile` —que el proveedor reconstruye en cada
   * render— se relanza siempre, su limpieza cancela el sondeo en vuelo, y como
   * la dirección ya quedó marcada como intentada no se reengancha nunca.
   */
  const deps = fuente.slice(fuente.lastIndexOf("}, ["));
  ok(
    "el efecto NO depende del objeto `profile`, solo de valores",
    !/^\}, \[[^\]]*\bprofile\b/.test(deps),
    deps
  );
  ok(
    "la canónica entra al efecto como cadena, no como objeto",
    /canonicalKey,/.test(deps) && /const canonicalKey =/.test(fuente)
  );
  ok(
    "`reconnect` se llama por ref, porque wagmi no promete identidad estable",
    /reconnectRef\.current\(/.test(fuente) && !/^\}, \[[^\]]*reconnect,/.test(deps)
  );

  const providers = readFileSync(join(ROOT, "lib/wallet-providers.tsx"), "utf8");
  ok(
    "y el puente está montado dentro de ProfileProvider (necesita la canónica)",
    providers.indexOf("<ProfileProvider>") <
      providers.indexOf("<CanonicalWalletBridge />"),
    "montado fuera del perfil no sabría cuál es la canónica"
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
