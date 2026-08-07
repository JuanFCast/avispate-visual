// Cuánto cuesta de verdad una jugada en tarifa de red, y para cuántas alcanza
// el regalo de bienvenida (0.1 CELO) que /api/welcome-gas manda a cada wallet
// embebida nueva.
//
// No estima: mide sobre las transacciones `play()` que YA ocurrieron en Celo
// mainnet, leyendo el gas y el precio realmente pagados en cada recibo.
//
// Las jugadas se sacan de la tabla `plays` (que guarda el tx_hash de cada una)
// en vez de barrer eventos: los RPC públicos limitan el rango por consulta y
// aquí ya tenemos las transacciones exactas.
//
// Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local.
// Correr: node scripts/gas-cost.mjs
import { readFileSync } from "fs";
import { createPublicClient, http, formatEther } from "viem";
import { celo } from "viem/chains";

/** Lo que regala /api/welcome-gas a cada wallet embebida nueva. */
const WELCOME_GAS = 10n ** 17n; // 0.1 CELO
/** Cuántas jugadas recientes se miran para promediar. */
const SAMPLE = 15;

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !KEY) {
  console.log("❌ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const client = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

const rows = await (
  await fetch(
    `${SB}/rest/v1/plays?select=tx_hash,is_paid,created_at&order=created_at.desc&limit=${SAMPLE}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  )
).json();

console.log(`jugadas a medir: ${rows.length}\n`);

let total = 0n;
let max = 0n;
let n = 0;
for (const row of rows) {
  const receipt = await client.getTransactionReceipt({ hash: row.tx_hash });
  const tx = await client.getTransaction({ hash: row.tx_hash });
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  total += fee;
  if (fee > max) max = fee;
  n++;
  console.log(
    `gas=${String(receipt.gasUsed).padStart(7)}` +
      `  precio=${(Number(receipt.effectiveGasPrice) / 1e9).toFixed(2)} gwei` +
      `  tarifa=${Number(formatEther(fee)).toFixed(6)} CELO` +
      `  pagada en=${tx.feeCurrency ? "USDT (CIP-64)" : "CELO"}` +
      `  ${row.is_paid ? "paga" : "gratis"}`
  );
}

if (n === 0) {
  console.log("Sin jugadas en el rango consultado.");
  process.exit(0);
}

const avg = total / BigInt(n);
console.log(`\nmedia:  ${Number(formatEther(avg)).toFixed(6)} CELO por jugada`);
console.log(`peor:   ${Number(formatEther(max)).toFixed(6)} CELO`);
console.log(
  `\n0.1 CELO de bienvenida alcanza para ~${WELCOME_GAS / avg} jugadas ` +
    `(~${WELCOME_GAS / max} en el peor caso medido)`
);

const price = await client.getGasPrice();
console.log(`precio del gas ahora: ${(Number(price) / 1e9).toFixed(3)} gwei`);
