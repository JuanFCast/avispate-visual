// Qué se hace con una jugada que no se pudo registrar, caso por caso.
//
// El fallo que cierra este verificador (2026-08-26): `/api/plays` contestaba
// `invalid_payment` a TODO —incluido un hash que la red nunca vio— y ese error
// es reintentable, así que la jugada se quedaba 48 h en la bandeja del
// dispositivo reintentándose contra la nada, con el botón en "Registrando
// jugada…" y sin salida desde la app.
//
// Las dos reglas que se prueban aquí tiran en direcciones opuestas a propósito,
// y las dos importan:
//
//   - NADA se descarta porque un nodo no lo encuentre. Así se pierde una jugada
//     pagada, y ya pasó en este proyecto.
//   - NADA se queda atrapado para siempre. Así se pierde a la persona.
//
// Correr: node scripts/verify-pending-fate.ts
import {
  decidePendingFate,
  verdictFromError,
  UNKNOWN_GRACE_MS,
  type PlayVerdict,
} from "../lib/pending-fate.ts";
import {
  decideTxPresence,
  MIN_NODES_FOR_UNKNOWN,
  type NodeAnswer,
} from "../lib/tx-presence.ts";

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

const VIEJO = UNKNOWN_GRACE_MS + 1000;
const NUEVO = 1000;

/* ── 1. Los cinco casos que pidió Juan, uno por uno ──────────────────────── */

console.log("\n— 1. Un veredicto de la cadena, una respuesta —\n");

{
  const casos: Array<[string, PlayVerdict, number, string, boolean]> = [
    // [nombre, veredicto, edad, acción esperada, suelta el candado]
    ["minada y correcta → se juega", "ok", NUEVO, "start", true],
    ["revertida → se cierra y se puede volver a jugar", "reverted", NUEVO, "drop_and_allow", true],
    ["en vuelo → se espera, sin permitir otro cobro", "pending", NUEVO, "keep_waiting", false],
    ["en vuelo y vieja → se sigue esperando igual", "pending", VIEJO, "keep_waiting", false],
    ["inexistente pero recién enviada → se espera", "unknown", NUEVO, "keep_waiting", false],
    ["inexistente y pasada la gracia → se ofrece salida", "unknown", VIEJO, "offer_discard", false],
    ["minada sin nuestro evento → se conserva", "invalid", VIEJO, "keep_retrying", false],
    ["cadena incomunicada → se conserva", "unavailable", VIEJO, "keep_retrying", false],
    ["servidor caído → se conserva", "server_error", VIEJO, "keep_retrying", false],
  ];
  for (const [nombre, verdict, ageMs, accion, suelta] of casos) {
    const f = decidePendingFate({ verdict, ageMs });
    ok(
      nombre,
      f.action === accion && f.releasesLock === suelta,
      JSON.stringify(f)
    );
  }
}

/* ── 2. La invariante del dinero ─────────────────────────────────────────── */

console.log("\n— 2. Solo la cadena puede soltar el candado —\n");

{
  const verdicts: PlayVerdict[] = [
    "ok",
    "reverted",
    "pending",
    "unknown",
    "invalid",
    "unavailable",
    "server_error",
  ];
  const edades = [0, 1000, UNKNOWN_GRACE_MS - 1, UNKNOWN_GRACE_MS, VIEJO, 1e9];

  const sueltan = new Set<PlayVerdict>();
  const borran = new Set<PlayVerdict>();
  for (const v of verdicts) {
    for (const ageMs of edades) {
      const f = decidePendingFate({ verdict: v, ageMs });
      if (f.releasesLock) sueltan.add(v);
      if (f.action === "drop_and_allow") borran.add(v);
    }
  }
  ok(
    "solo 'ok' y 'reverted' sueltan el candado, a cualquier edad",
    sueltan.size === 2 && sueltan.has("ok") && sueltan.has("reverted"),
    `sueltan: ${[...sueltan].join(", ")}`
  );
  ok(
    "solo 'reverted' borra el envío por su cuenta",
    borran.size === 1 && borran.has("reverted"),
    `borran: ${[...borran].join(", ")}`
  );
  ok(
    "'unknown' NUNCA borra solo: como mucho, propone",
    edades.every(
      (ageMs) =>
        decidePendingFate({ verdict: "unknown", ageMs }).action !==
        "drop_and_allow"
    )
  );
}

/* ── 3. Un código que no conocemos no puede tirar una jugada ─────────────── */

console.log("\n— 3. Códigos del servidor, incluidos los que no existen —\n");

{
  const mapa: Array<[string | undefined, PlayVerdict]> = [
    ["payment_reverted", "reverted"],
    ["payment_pending", "pending"],
    ["payment_unknown", "unknown"],
    ["invalid_payment", "invalid"],
    ["chain_unavailable", "unavailable"],
    ["server_error", "server_error"],
    // Una app vieja hablando con un servidor nuevo. Se lee como fallo del
    // servidor, que es la lectura que CONSERVA el envío.
    ["codigo_del_futuro", "server_error"],
    [undefined, "server_error"],
  ];
  for (const [code, esperado] of mapa) {
    ok(
      `"${code ?? "(sin código)"}" → ${esperado}`,
      verdictFromError(code) === esperado,
      verdictFromError(code)
    );
  }
  ok(
    "ningún código desconocido puede terminar en un borrado",
    ["", "raro", "payment_reverted_x", "PAYMENT_REVERTED"].every(
      (c) =>
        decidePendingFate({ verdict: verdictFromError(c), ageMs: 1e9 })
          .action === "keep_retrying"
    )
  );
}

/* ── 4. Y el consenso entre nodos que hay detrás de "no existe" ──────────── */

console.log("\n— 4. Un nodo solo no decide que algo no existe —\n");

{
  const casos: Array<[string, NodeAnswer[], string]> = [
    ["uno la tiene minada", ["receipt", "unknown", "unknown"], "mined"],
    ["uno la tiene minada y los demás callan", ["unreachable", "receipt"], "mined"],
    ["uno la conoce sin minar", ["known", "unknown"], "pending"],
    ["minado gana sobre conocido", ["known", "receipt"], "mined"],
    ["dos dicen que no existe", ["unknown", "unknown"], "unknown"],
    ["uno solo dice que no existe", ["unknown", "unreachable"], "unavailable"],
    ["uno solo, sin nadie más", ["unknown"], "unavailable"],
    ["nadie contestó", ["unreachable", "unreachable"], "unavailable"],
    ["sin nodos", [], "unavailable"],
  ];
  for (const [nombre, answers, esperado] of casos) {
    ok(
      `${nombre} → ${esperado}`,
      decideTxPresence(answers) === esperado,
      decideTxPresence(answers)
    );
  }
  ok(
    `hacen falta ${MIN_NODES_FOR_UNKNOWN} negativas, no una`,
    MIN_NODES_FOR_UNKNOWN >= 2 &&
      decideTxPresence(["unknown"]) === "unavailable"
  );

  /**
   * La combinación que importa de las dos reglas juntas: una sola negativa
   * jamás puede terminar ofreciéndole a nadie que descarte su jugada.
   */
  const presencia = decideTxPresence(["unknown", "unreachable"]);
  const verdict: PlayVerdict =
    presencia === "unknown" ? "unknown" : "unavailable";
  ok(
    "con una sola negativa NO se ofrece descartar, ni pasada la gracia",
    decidePendingFate({ verdict, ageMs: 1e9 }).action === "keep_retrying",
    `presencia=${presencia}`
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
