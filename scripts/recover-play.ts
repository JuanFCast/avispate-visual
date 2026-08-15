// Repone en `plays` un recibo que se cobró en la cadena y nunca llegó al
// servidor, leyendo ÚNICAMENTE el evento `Played` de la transacción.
//
// Cuándo hace falta: `/api/plays` se llama apenas la transacción se confirma, y
// si ese envío no llega a guardarse en el teléfono la entrada queda cobrada sin
// rastro en el servidor — ni ranking, ni forma de saber a quién compensar. La
// tabla `plays` existe justo para eso (ver su migración).
//
// La regla de este script, y no se negocia: **todo dato sale del evento**.
// Quién pagó, qué mazo y si fue gratis los dice el contrato, no quien ejecuta
// esto. Si algo no cuadra, no escribe nada.
//
// Correr (primero en seco, que es lo que hace por defecto):
//   node scripts/recover-play.ts 0x<txHash>
//   node scripts/recover-play.ts 0x<txHash> --write
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseEventLogs, type Hash } from "viem";
import { celo } from "viem/chains";

const TX_RE = /^0x[0-9a-f]{64}$/i;

const txHash = process.argv[2];
const escribir = process.argv.includes("--write");

if (!txHash || !TX_RE.test(txHash)) {
  console.error("Uso: node scripts/recover-play.ts 0x<txHash> [--write]");
  process.exit(1);
}

/* ── Entorno ─────────────────────────────────────────────────────────────── */

const env: Record<string, string> = {};
for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(linea.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const POT = (env.NEXT_PUBLIC_AVISPATE_POT_ADDRESS || "").toLowerCase();
const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!POT || !SUPABASE || !KEY) {
  console.error("Falta POT / SUPABASE_URL / SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const PLAYED_ABI = [
  {
    type: "event",
    name: "Played",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "deck", type: "uint8", indexed: true },
      { name: "toPot", type: "uint256", indexed: false },
      { name: "commission", type: "uint256", indexed: false },
      { name: "wasFree", type: "bool", indexed: false },
    ],
  },
] as const;

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

function alto(motivo: string): never {
  console.error(`\n✗ NO se escribe nada: ${motivo}\n`);
  process.exit(1);
}

/* ── 1. La cadena, que es la única fuente ────────────────────────────────── */

console.log(`\nTransacción: ${txHash}\n`);

const receipt = await client
  .getTransactionReceipt({ hash: txHash as Hash })
  .catch(() => null);
if (!receipt) alto("la transacción no existe o el nodo no la tiene");
if (receipt.status !== "success") alto(`la transacción no fue exitosa (${receipt.status})`);

// El evento tiene que venir de NUESTRO contrato. Filtrar por emisor es lo que
// impide que un contrato cualquiera falsifique un `Played` con la forma justa.
const eventos = parseEventLogs({
  abi: PLAYED_ABI,
  eventName: "Played",
  logs: receipt.logs.filter((l) => l.address.toLowerCase() === POT),
});
if (eventos.length !== 1) {
  alto(`se esperaba exactamente 1 evento Played del pozo, hay ${eventos.length}`);
}

const ev = eventos[0];
const player = ev.args.player.toLowerCase();
const deckSize = Number(ev.args.deck);
const wasFree = Boolean(ev.args.wasFree);
const bloque = await client.getBlock({ blockNumber: receipt.blockNumber });
const minado = new Date(Number(bloque.timestamp) * 1000);
const roundDate = minado.toISOString().slice(0, 10);

console.log("Lo que dice el contrato:");
console.log("  jugador   :", player);
console.log("  mazo      :", deckSize);
console.log("  entrada   :", wasFree ? "gratis (consumió la del día)" : "PAGADA");
console.log("  al pozo   :", ev.args.toPot.toString(), "| comisión:", ev.args.commission.toString());
console.log("  minado    :", minado.toISOString(), `(ronda ${roundDate})`);

if (![10, 15, 20].includes(deckSize)) alto(`mazo fuera de rango: ${deckSize}`);

/* ── 2. Estado actual en el servidor ─────────────────────────────────────── */

const yaEsta = await (
  await fetch(`${SUPABASE}/rest/v1/plays?select=tx_hash,created_at,recovered_note&tx_hash=eq.${txHash.toLowerCase()}`, { headers: H })
).json();
if (Array.isArray(yaEsta) && yaEsta.length > 0) {
  console.log("\n✓ Ya estaba registrada. No hay nada que reponer.");
  console.log(" ", JSON.stringify(yaEsta[0]));
  process.exit(0);
}

// El perfil se busca por la dirección DEL EVENTO, nunca por otra cosa.
const perfiles = await (
  await fetch(`${SUPABASE}/rest/v1/profiles?select=id,alias,wallet_address&wallet_address=eq.${player}`, { headers: H })
).json();
if (!Array.isArray(perfiles) || perfiles.length !== 1) {
  alto(`se esperaba 1 perfil para ${player}, hay ${perfiles?.length ?? "?"}`);
}
const perfil = perfiles[0];
console.log("\nPerfil de quien pagó:", perfil.alias, `(${perfil.id})`);

/* ── 3. La fila, derivada entera del evento ──────────────────────────────── */

const nota =
  `recuperada a mano del evento Played de ${txHash.toLowerCase()} ` +
  `(bloque ${receipt.blockNumber}, minado ${minado.toISOString()}); ` +
  `el recibo nunca llegó a /api/plays. Repuesta el ${new Date().toISOString()}.`;

const fila = {
  profile_id: perfil.id,
  tx_hash: txHash.toLowerCase(),
  deck_size: deckSize,
  round_date: roundDate,
  is_paid: !wasFree,
  // Sin semilla A PROPÓSITO: la semilla la emite `/api/plays` antes de la
  // primera carta, y sin ella la partida nunca llegó a empezar. Reponerla
  // ahora no devolvería la partida; solo abriría la puerta a un puntaje de
  // una partida que no se jugó. El recibo es para compensar, no para rejugar.
  seed: null,
  recovered_note: nota,
};

console.log("\nFila a insertar:");
console.log(JSON.stringify({ ...fila, recovered_note: "…" }, null, 2));
console.log("\nnota:", nota);

if (!escribir) {
  console.log("\n(en seco — vuelve a correrlo con --write para escribir)\n");
  process.exit(0);
}

const res = await fetch(`${SUPABASE}/rest/v1/plays`, {
  method: "POST",
  headers: { ...H, Prefer: "return=representation" },
  body: JSON.stringify(fila),
});
const cuerpo = await res.text();
if (!res.ok) alto(`la inserción falló (${res.status}): ${cuerpo}`);

console.log("\n✓ Recibo repuesto:\n", cuerpo, "\n");
