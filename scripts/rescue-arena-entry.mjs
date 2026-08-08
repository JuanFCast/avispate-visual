// Encuentra y recupera entradas de la Arena que quedaron atrapadas en el
// escrow: mesas que se pagaron y nunca llegaron a jugarse.
//
// Existe por un caso real. Antes, la fila de una silla pagada se borraba de
// nuestra base en cuanto el jugador pasaba un minuto sin latir, o en cuanto
// tocaba "Otra sala": la entrada se quedaba dentro del contrato y la aplicación
// dejaba de saber que existía. Eso ya no pasa, pero el dinero de las mesas
// afectadas sigue ahí y hay que ir a buscarlo.
//
// No adivina nada: lee los eventos `Joined` de la cadena, que son la verdad de
// quién pagó qué. Por defecto solo MIRA e informa.
//
//   node scripts/rescue-arena-entry.mjs 0xTuWallet            → qué hay atrapado
//   node scripts/rescue-arena-entry.mjs 0xTuWallet --refund   → recuperarlo
//
// Con `--refund` firma el Operator (lee OPERATOR_PRIVATE_KEY de contracts/.env)
// para poder anular la mesa. La devolución va SIEMPRE a la dirección que pagó,
// nunca a quien firma: eso lo garantiza el contrato, no este script.
import { readFileSync } from "fs";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const WALLET = process.argv[2];
const DO_REFUND = process.argv.includes("--refund");

if (!WALLET || !/^0x[0-9a-fA-F]{40}$/.test(WALLET)) {
  console.log("Uso: node scripts/rescue-arena-entry.mjs 0xTuWallet [--refund]");
  process.exit(1);
}

function env(file, key) {
  try {
    const m = readFileSync(file, "utf8").match(
      new RegExp(`^${key}=(.+)$`, "m")
    );
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const ARENA =
  env(".env.local", "NEXT_PUBLIC_AVISPATE_ARENA_ADDRESS") ??
  env("contracts/.env", "ARENA_ADDRESS");

if (!ARENA || !/^0x[0-9a-fA-F]{40}$/.test(ARENA)) {
  console.log("❌ No encuentro la dirección del contrato de la Arena.");
  console.log("   Ponla en .env.local como NEXT_PUBLIC_AVISPATE_ARENA_ADDRESS.");
  process.exit(1);
}

const abi = parseAbi([
  "event Joined(bytes32 indexed tableId, address indexed player, uint8 seats, bytes32 seatCommitment)",
  "function tableOf(bytes32 tableId) view returns (uint8 status, uint256 entry, uint8 maxPlayers, uint8 seats, uint64 openedAt, uint64 filledAt)",
  "function paid(bytes32 tableId, address player) view returns (bool)",
  "function refunded(bytes32 tableId, address player) view returns (bool)",
  "function openTimeout() view returns (uint256)",
  "function settleTimeout() view returns (uint256)",
  "function voidTable(bytes32 tableId)",
  "function voidByTimeout(bytes32 tableId)",
  "function refund(bytes32 tableId, address player)",
]);

const ESTADO = ["Sin abrir", "Abierta", "Llena", "Pagada", "Anulada"];
const OPEN = 1;
const FULL = 2;
const SETTLED = 3;
const VOIDED = 4;

const pub = createPublicClient({ chain: celo, transport: http() });
const usdt = (units) => (Number(units) / 1e6).toFixed(2);

const logs = await pub.getLogs({
  address: ARENA,
  event: abi.find((a) => a.type === "event" && a.name === "Joined"),
  args: { player: WALLET },
  fromBlock: 0n,
  toBlock: "latest",
});

if (logs.length === 0) {
  console.log(`\nNo hay ninguna entrada pagada desde ${WALLET}.\n`);
  process.exit(0);
}

const tables = [...new Set(logs.map((l) => l.args.tableId))];
console.log(`\n${tables.length} mesa(s) pagada(s) desde ${WALLET}:\n`);

const ahora = Math.floor(Date.now() / 1000);
const openTimeout = await pub.readContract({
  address: ARENA,
  abi,
  functionName: "openTimeout",
});

const rescatables = [];

for (const tableId of tables) {
  const [status, entry, maxPlayers, seats, openedAt] = await pub.readContract({
    address: ARENA,
    abi,
    functionName: "tableOf",
    args: [tableId],
  });
  const yaDevuelta = await pub.readContract({
    address: ARENA,
    abi,
    functionName: "refunded",
    args: [tableId, WALLET],
  });

  const linea = `  ${tableId.slice(0, 10)}…  ${usdt(entry)} USDT  ${seats}/${maxPlayers}  ${ESTADO[status]}`;

  if (yaDevuelta) {
    console.log(`${linea}  → ya devuelta ✓`);
    continue;
  }
  if (status === SETTLED) {
    console.log(`${linea}  → se jugó y se pagó al ganador`);
    continue;
  }
  if (status === VOIDED) {
    console.log(`${linea}  → anulada: se puede retirar YA`);
    rescatables.push({ tableId, entry, needsVoid: false });
    continue;
  }
  if (status === OPEN) {
    // Nunca se llenó: es exactamente el caso del dólar atrapado.
    const puedeCualquiera = ahora >= Number(openedAt) + Number(openTimeout);
    console.log(
      `${linea}  → nunca se llenó${puedeCualquiera ? "" : " (plazo público aún corriendo)"}`
    );
    rescatables.push({ tableId, entry, needsVoid: true, puedeCualquiera });
    continue;
  }
  if (status === FULL) {
    console.log(`${linea}  → llena y sin liquidar: la resuelve el cron`);
    continue;
  }
  console.log(linea);
}

const total = rescatables.reduce((s, r) => s + Number(r.entry), 0) / 1e6;
if (rescatables.length === 0) {
  console.log("\nNo hay nada atrapado. Todo está jugado o ya devuelto.\n");
  process.exit(0);
}

console.log(
  `\n${rescatables.length} recuperable(s), ${total.toFixed(2)} USDT en total.`
);

if (!DO_REFUND) {
  console.log("Para recuperarlo: vuelve a correr esto con --refund\n");
  process.exit(0);
}

const pk = env("contracts/.env", "OPERATOR_PRIVATE_KEY");
if (!pk) {
  console.log("\n❌ Falta OPERATOR_PRIVATE_KEY en contracts/.env.");
  console.log(
    "   Sin ella solo se pueden anular las mesas cuyo plazo público ya venció."
  );
  process.exit(1);
}

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const wallet = createWalletClient({ account, chain: celo, transport: http() });
console.log(`\nFirmando con ${account.address}\n`);

for (const r of rescatables) {
  try {
    if (r.needsVoid) {
      const hash = await wallet.writeContract({
        address: ARENA,
        abi,
        functionName: "voidTable",
        args: [r.tableId],
      });
      await pub.waitForTransactionReceipt({ hash });
      console.log(`  anulada  ${r.tableId.slice(0, 10)}…  ${hash}`);
    }
    // El destino es siempre el jugador, lo firme quien lo firme.
    const hash = await wallet.writeContract({
      address: ARENA,
      abi,
      functionName: "refund",
      args: [r.tableId, WALLET],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  devuelta ${r.tableId.slice(0, 10)}…  ${usdt(r.entry)} USDT  ${hash}`);
  } catch (e) {
    console.log(`  ❌ ${r.tableId.slice(0, 10)}…  ${e.shortMessage ?? e.message}`);
  }
}

console.log("");
