import { fallback, http, type Transport } from "viem";
import { celo } from "viem/chains";

/**
 * Configuración de redes. Celo es la red principal de Avíspate (la wallet
 * embebida se provisiona ahí). Base y Mainnet quedan disponibles para leer
 * balances o recibir en otras cadenas si hiciera falta.
 */

// RPCs públicos de Celo como red de seguridad si no hay uno propio (Alchemy).
const FORNO_RPC = "https://forno.celo.org";
const DRPC_RPC = "https://celo.drpc.org";

/** RPC preferido de Celo: el propio (Alchemy) si está configurado, si no Forno. */
export const CELO_RPC_URL = process.env.NEXT_PUBLIC_CELO_RPC_URL || FORNO_RPC;

/**
 * Transporte de Celo con failover: RPC propio → Forno → dRPC. Así, un tropiezo
 * simultáneo del RPC propio + Forno todavía deja el juego sirviendo.
 */
export const CELO_TRANSPORT: Transport = fallback([
  http(CELO_RPC_URL),
  http(FORNO_RPC),
  http(DRPC_RPC),
]);

/** RPC de Ethereum Mainnet (público por defecto, override por env). */
export const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
  "https://ethereum-rpc.publicnode.com";

/** Red activa por defecto para pagos/premios. */
export const ACTIVE_CHAIN = celo;
