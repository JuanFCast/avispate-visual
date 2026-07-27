/**
 * Config on-chain de Avíspate (Celo). Las direcciones de tokens son constantes;
 * la del contrato AvispatePot llega por env tras el despliegue.
 */

/** USDT (Tether) en Celo mainnet, 6 decimales. Verifícala en Celoscan. */
export const USDT_CELO_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
export const USDT_DECIMALS = 6;

/**
 * COPm (Mento Colombian Peso) en Celo mainnet: el peso colombiano digital.
 *
 * Verificado leyendo el propio contrato el 2026-07-26: `name()` devuelve
 * "Mento Colombian Peso", `symbol()` devuelve "COPm" y `decimals()` devuelve
 * 18 — OJO, no 6 como USDT. En CoinGecko aparece como COPM y en Coinbase como
 * cCOP; es el mismo token.
 */
export const COPM_CELO_ADDRESS = "0x8a567e2ae79ca692bd748ab832081c45de4041ea";
export const COPM_DECIMALS = 18;

/** Adaptador CIP-64 para pagar gas en USDT (sin necesitar CELO). */
export const CIP64_FEE_ADAPTER = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";

/** Dirección del contrato AvispatePot (se llena tras desplegar). */
export const AVISPATE_POT_ADDRESS = (
  process.env.NEXT_PUBLIC_AVISPATE_POT_ADDRESS || ""
).toLowerCase();

/** Costo de una jugada paga, en unidades del token (0.10 USDT = 100000). */
export const FEE_AMOUNT = BigInt(
  process.env.NEXT_PUBLIC_AVISPATE_FEE_AMOUNT || "100000"
);

/**
 * Allowance que se aprueba de una vez: varias jugadas por adelantado, NUNCA
 * ilimitado. MiniPay limita el monto que una Mini App puede pedir en approve y
 * auto-rechaza `maxUint256` con -32604 sin mostrar la hoja de firma.
 */
export const APPROVE_UNITS = FEE_AMOUNT * 10n;

/** ABI mínimo que usa el frontend/backend del contrato AvispatePot (v2). */
export const AVISPATE_POT_ABI = [
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
  {
    type: "function",
    name: "play",
    stateMutability: "nonpayable",
    inputs: [{ name: "deck", type: "uint8" }],
    outputs: [{ name: "wasFree", type: "bool" }],
  },
  {
    type: "function",
    name: "hasFreePlayToday",
    stateMutability: "view",
    inputs: [
      { name: "deck", type: "uint8" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "currentDay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pot",
    stateMutability: "view",
    inputs: [{ name: "deck", type: "uint8" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Getters de las variables públicas: el panel /stats lee la economía REAL del
  // contrato en vez de repetir aquí un 0.10 / 20% que podría quedar viejo.
  {
    type: "function",
    name: "feeAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "commissionBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "deck", type: "uint8" },
      { name: "winner", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "seedPot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "deck", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** ABI mínimo de ERC-20 para approve/allowance de USDT. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
