// Recupera los pozos de un contrato AvispatePot que se va a retirar: llama
// settle(deck, FUNDER) por cada mazo con saldo, enviando TODO al Funder
// Rewards para re-sembrarlo en el contrato nuevo. Firma el Operator (o el
// Owner), que son los únicos autorizados para settle.
// Lee OPERATOR_PRIVATE_KEY de contracts/.env.
// Correr: node scripts/recover-pots.mjs 0xCONTRATO_VIEJO
import { readFileSync } from "fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const FUNDER = "0x46d5F9fE98461928DbAd7a22B95BADE5Fa178C18";
const DECKS = [10, 15, 20];

const POT = process.argv[2];
if (!POT || !/^0x[0-9a-fA-F]{40}$/.test(POT)) {
  console.log("Uso: node scripts/recover-pots.mjs 0xCONTRATO_VIEJO");
  process.exit(1);
}

const env = readFileSync("contracts/.env", "utf8");
const m = env.match(/OPERATOR_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/);
if (!m) {
  console.log("❌ Falta OPERATOR_PRIVATE_KEY en contracts/.env");
  process.exit(1);
}
const account = privateKeyToAccount(m[1]);

const potAbi = [
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ type: "uint8" }, { type: "address" }], outputs: [] },
  { type: "function", name: "pot", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ type: "uint256" }] },
];

const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const wallet = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });

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

console.log("Operator:", account.address);
console.log("Contrato viejo:", POT);
console.log("Destino (Funder):", FUNDER);

let total = 0n;
for (const deck of DECKS) {
  const bal = await pub.readContract({ address: POT, abi: potAbi, functionName: "pot", args: [deck] });
  if (bal === 0n) {
    console.log(`Pozo mazo ${deck}: vacío, se salta ✅`);
    continue;
  }
  console.log(`Pozo mazo ${deck}: ${Number(bal) / 1e6} USDT → Funder…`);
  await sendWithRetry({ address: POT, abi: potAbi, functionName: "settle", args: [deck, FUNDER] });
  total += bal;
  console.log(`  recuperado ✅`);
}
console.log(`🎉 Total recuperado: ${Number(total) / 1e6} USDT`);
