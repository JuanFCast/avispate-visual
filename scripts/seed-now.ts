// Siembra a mano los pozos hasta el suelo, desde el Funder Rewards.
//
// Es la versión de escritorio del robot horario (`/api/cron/seed-pots`): la
// MISMA regla (`lib/seed-rules.ts`), sin base de datos ni cerrojo, para cuando
// hay que arreglar algo ahora mismo sin esperar al cron. Reemplaza al viejo
// `seed-pots.mjs`, que ponía 1 USDT fijo por mazo en vez de completar el suelo.
//
// Lee FUNDER_PRIVATE_KEY de contracts/.env y la dirección del pozo de .env.local.
// Por defecto NO firma nada: enseña el plan y se va. Hay que pedirlo con --yes.
//
// Correr:  node scripts/seed-now.ts          (solo mira y cuenta)
//          node scripts/seed-now.ts --yes    (firma)
//          node scripts/seed-now.ts --yes --deck 10
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPublicClient, createWalletClient, http, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import {
  planSeed,
  fmtUnits,
  FLOOR_UNITS,
  ROUND_CAP_UNITS,
  RUN_CAP_UNITS,
} from "../lib/seed-rules.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const DECKS = [10, 15, 20];

const args = process.argv.slice(2);
const commit = args.includes("--yes");
const onlyDeck = args.includes("--deck")
  ? Number(args[args.indexOf("--deck") + 1])
  : null;
const decks = onlyDeck ? [onlyDeck] : DECKS;

/** Saca una clave de un archivo .env sin arrastrar dependencias. */
function envValue(file: string, key: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(join(ROOT, file), "utf8");
  } catch {
    return null;
  }
  const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const pk = envValue("contracts/.env", "FUNDER_PRIVATE_KEY");
const POT = envValue(".env.local", "NEXT_PUBLIC_AVISPATE_POT_ADDRESS");
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  console.log("❌ Falta FUNDER_PRIVATE_KEY en contracts/.env");
  process.exit(1);
}
if (!POT || !/^0x[0-9a-fA-F]{40}$/.test(POT)) {
  console.log("❌ Falta NEXT_PUBLIC_AVISPATE_POT_ADDRESS en .env.local");
  process.exit(1);
}

const erc20 = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const potAbi = [
  { type: "function", name: "seedPot", stateMutability: "nonpayable", inputs: [{ type: "uint8" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "pot", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ type: "uint256" }] },
] as const;

const account = privateKeyToAccount(pk as `0x${string}`);
const rpc = http("https://forno.celo.org");
const pub = createPublicClient({ chain: celo, transport: rpc });
const wallet = createWalletClient({ account, chain: celo, transport: rpc });

const readPot = (deck: number) =>
  pub.readContract({
    address: POT as `0x${string}`,
    abi: potAbi,
    functionName: "pot",
    args: [deck],
  }) as Promise<bigint>;

/**
 * Relee el pozo hasta que el nodo se ponga al día.
 *
 * Forno reparte entre varios nodos y el que contesta la lectura de después de
 * un `seedPot` puede ir un bloque por detrás del que la aceptó: la primera
 * corrida de esto imprimió 0,00 en los tres mazos con las tres transacciones ya
 * confirmadas, y se despidió con código 1 diciendo que había fallado. No es una
 * espera de cortesía; sin ella el informe MIENTE.
 */
async function readPotSettled(deck: number, esperado: bigint): Promise<bigint> {
  let pot = await readPot(deck);
  for (let i = 0; i < 5 && pot < esperado; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    pot = await readPot(deck);
  }
  return pot;
}

const [balance, allowance] = await Promise.all([
  pub.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
  pub.readContract({ address: USDT, abi: erc20, functionName: "allowance", args: [account.address, POT as `0x${string}`] }) as Promise<bigint>,
]);

console.log(`\nFunder     ${account.address}`);
console.log(`USDT       ${fmtUnits(balance)}`);
console.log(`allowance  ${allowance > 10n ** 30n ? "ilimitada" : fmtUnits(allowance)}`);
console.log(`Pozo       ${POT}`);
console.log(`Suelo      ${fmtUnits(FLOOR_UNITS)} por mazo\n`);

// Mismo gas fijo que el robot: sembrar un pozo recién vaciado cuesta ~20k más
// que sembrar uno con saldo, y la estimación no siempre lo ve.
const SEED_GAS = 150_000n;

let firmadas = 0;
let previsto = 0n;

for (const deck of decks) {
  const pot = await readPot(deck);
  const decision = planSeed({
    pot,
    floor: FLOOR_UNITS,
    // A mano no hay contador de ronda: lo que protege aquí es el tope por
    // transacción, y que el plan se enseña antes de firmar.
    spentThisRound: 0n,
    roundCap: ROUND_CAP_UNITS,
    runCap: RUN_CAP_UNITS,
    // La guarda de cierre es cosa del robot horario. Aquí decide la persona.
    closePending: false,
    funderBalance: balance - previsto,
    allowance,
  });

  const head = `mazo ${String(deck).padStart(2)} · pozo ${fmtUnits(pot).padStart(6)}`;

  if (!decision.act) {
    const marca = decision.kind === "abort" ? "⛔" : "  ";
    console.log(`${marca} ${head} → ${decision.reason}`);
    continue;
  }

  previsto += decision.amount;

  if (!commit) {
    console.log(`   ${head} → aportaría ${fmtUnits(decision.amount)}`);
    continue;
  }

  process.stdout.write(`   ${head} → aporta ${fmtUnits(decision.amount)} … `);
  try {
    // Nonce fresco en cada intento, por el choque con el sembrador de TypeRush
    // (la misma wallet Funder sirve a los dos juegos).
    const nonce = await pub.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    const hash = (await wallet.writeContract({
      address: POT as `0x${string}`,
      abi: potAbi,
      functionName: "seedPot",
      args: [deck, decision.amount],
      nonce,
      gas: SEED_GAS,
    })) as Hash;
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      console.log(`revertida ❌  ${hash}`);
      continue;
    }
    firmadas++;
    console.log(`${fmtUnits(await readPotSettled(deck, pot + decision.amount))} ✅  ${hash}`);
  } catch (e) {
    console.log(`falló ❌  ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (!commit) {
  console.log(
    previsto === 0n
      ? "\nNada que hacer: los pozos ya están en el suelo.\n"
      : `\nEn total pondría ${fmtUnits(previsto)} USDT. Repite con --yes para firmar.\n`
  );
} else {
  console.log(`\n${firmadas} siembra(s) confirmada(s).`);
  const finales = await Promise.all(
    decks.map((d) => readPotSettled(d, FLOOR_UNITS))
  );
  console.log(
    "Estado final: " +
      decks.map((d, i) => `mazo ${d} = ${fmtUnits(finales[i])}`).join(" · ") +
      "\n"
  );
  process.exit(finales.some((p) => p < FLOOR_UNITS) ? 1 : 0);
}
