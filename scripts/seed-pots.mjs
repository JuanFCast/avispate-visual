// Siembra inicial de los 3 pozos (1 USDT cada uno) desde el Funder Rewards.
// Lee FUNDER_PRIVATE_KEY de contracts/.env. Correr: node scripts/seed-pots.mjs
import { readFileSync } from "fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const POT = "0x28B239a1b85fc2d87a0248B0EC319Ae3e6EB43f7";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const SEED = 1_000_000n; // 1 USDT (6 decimales)
const DECKS = [10, 15, 20];

const env = readFileSync("contracts/.env", "utf8");
const m = env.match(/FUNDER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/);
if (!m) {
  console.log("❌ Falta FUNDER_PRIVATE_KEY en contracts/.env");
  process.exit(1);
}
const account = privateKeyToAccount(m[1]);

const erc20 = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];
const potAbi = [
  { type: "function", name: "seedPot", stateMutability: "nonpayable", inputs: [{ type: "uint8" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "pot", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ type: "uint256" }] },
];

const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const wallet = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });

console.log("Funder:", account.address);
const needed = SEED * BigInt(DECKS.length);
const bal = await pub.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log("USDT disponible:", Number(bal) / 1e6);
if (bal < needed) {
  console.log(`❌ Falta USDT: necesita ${Number(needed) / 1e6}, tiene ${Number(bal) / 1e6}`);
  process.exit(1);
}

// Envía una transacción con nonce explícito y reintentos (la secuencia de Celo
// a veces devuelve un nonce viejo; reintentar lo resuelve).
async function sendWithRetry(params) {
  for (let attempt = 1; ; attempt++) {
    try {
      const nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
      const h = await wallet.writeContract({ ...params, nonce });
      const r = await pub.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("tx revertida");
      return h;
    } catch (e) {
      if (attempt >= 5) throw e;
      console.log(`  reintentando (${attempt})…`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

const allowance = await pub.readContract({ address: USDT, abi: erc20, functionName: "allowance", args: [account.address, POT] });
if (allowance < needed) {
  console.log("Autorizando al contrato a usar el USDT del Funder...");
  await sendWithRetry({ address: USDT, abi: erc20, functionName: "approve", args: [POT, maxUint256] });
  console.log("Autorizado ✅");
}

for (const deck of DECKS) {
  const current = await pub.readContract({ address: POT, abi: potAbi, functionName: "pot", args: [deck] });
  if (current >= SEED) {
    console.log(`Pozo mazo ${deck}: ${Number(current) / 1e6} USDT (ya sembrado, se salta) ✅`);
    continue;
  }
  await sendWithRetry({ address: POT, abi: potAbi, functionName: "seedPot", args: [deck, SEED] });
  const p = await pub.readContract({ address: POT, abi: potAbi, functionName: "pot", args: [deck] });
  console.log(`Pozo mazo ${deck}: ${Number(p) / 1e6} USDT ✅`);
}
console.log("🎉 ¡Pozos sembrados!");
