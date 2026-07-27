/**
 * Los tokens que la app le muestra al jugador, y por dónde se recargan.
 *
 * Todas las direcciones se verificaron leyendo el propio contrato (`name`,
 * `symbol`, `decimals`) el 2026-07-26, no copiándolas de una lista: una
 * dirección equivocada aquí manda a alguien a comprar el token que no es.
 */

import { formatUnits } from "viem";
import {
  COPM_CELO_ADDRESS,
  COPM_DECIMALS,
  USDT_CELO_ADDRESS,
  USDT_DECIMALS,
} from "./contracts";

/** CELO como ERC-20 en Celo (para los enlaces de swap/puente). */
const CELO_ERC20 = "0x471EcE3750Da237f93B8E339c536989b8978a438";
/** USDT en Ethereum: el origen del puente hacia Celo. */
const USDT_ETHEREUM = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

const CHAIN_ETHEREUM = 1;
const CHAIN_CELO = 42220;

/**
 * Pantalla "Agregar dinero" de MiniPay. Solo acepta USDm, USDT y USDC según
 * la documentación oficial de deeplinks: COPm NO está soportado, así que su
 * tarjeta no ofrece este camino.
 * https://docs.minipay.xyz/technical-references/deeplinks.html
 */
export const MINIPAY_ADD_CASH = "https://link.minipay.xyz/add_cash?tokens=USDT";

/** Puente Squid: traer el token desde Ethereum hasta Celo. */
function squidUrl(fromEthereum: string, toCelo: string): string {
  const chains = `${CHAIN_ETHEREUM}%2C${CHAIN_CELO}`;
  return `https://app.squidrouter.com/?chains=${chains}&tokens=${fromEthereum}%2C${toCelo}`;
}

/** Uniswap sobre Celo: cambiar un token de Celo por otro. */
function uniswapUrl(input: string, output: string): string {
  return `https://app.uniswap.org/swap?chain=celo&inputCurrency=${input}&outputCurrency=${output}`;
}

export interface TokenInfo {
  symbol: string;
  /** Dirección ERC-20. `undefined` = CELO nativo (no es un contrato). */
  address?: `0x${string}`;
  decimals: number;
  /** Decimales que se MUESTRAN: pesos no llevan centavos, CELO sí. */
  displayDecimals: number;
  /** Sufijo de la clase de color de la tarjeta. */
  tint: string;
  description: string;
  /** Enlace de puente desde Ethereum, si el token existe allá. */
  bridgeUrl?: string;
  /** Enlace de swap dentro de Celo. */
  swapUrl?: string;
  /** MiniPay puede recargarlo con su pantalla nativa. */
  miniPayAddCash: boolean;
  /**
   * MiniPay esconde esta tarjeta. CELO porque allá el gas es abstracto y el
   * usuario nunca lo necesita, y COPm porque no está en su lista de tokens:
   * dejar un saldo sin ninguna acción posible solo genera la pregunta
   * "¿y esto qué es?". Son sus reglas de publicación, no un capricho.
   */
  hiddenInMiniPay: boolean;
}

export const TOKENS: TokenInfo[] = [
  {
    symbol: "CELO",
    address: undefined,
    decimals: 18,
    displayDecimals: 4,
    tint: "celo",
    description: "Se usa para pagar las tarifas de la red.",
    bridgeUrl: squidUrl(
      "0x0000000000000000000000000000000000000000",
      CELO_ERC20
    ),
    swapUrl: uniswapUrl(USDT_CELO_ADDRESS, CELO_ERC20),
    miniPayAddCash: false,
    hiddenInMiniPay: true,
  },
  {
    symbol: "USDT",
    address: USDT_CELO_ADDRESS as `0x${string}`,
    decimals: USDT_DECIMALS,
    displayDecimals: 2,
    tint: "usdt",
    description: "Para entrar a partidas pagadas y recibir premios.",
    bridgeUrl: squidUrl(USDT_ETHEREUM, USDT_CELO_ADDRESS),
    swapUrl: uniswapUrl(CELO_ERC20, USDT_CELO_ADDRESS),
    miniPayAddCash: true,
    hiddenInMiniPay: false,
  },
  {
    symbol: "COPm",
    address: COPM_CELO_ADDRESS as `0x${string}`,
    decimals: COPM_DECIMALS,
    displayDecimals: 0,
    tint: "copm",
    description:
      "Peso colombiano digital en Celo. Todavía no se juega con él: las entradas se cobran en USDT.",
    // Sin puente: COPm solo existe en Celo, no hay nada que traer de Ethereum.
    bridgeUrl: undefined,
    swapUrl: uniswapUrl(USDT_CELO_ADDRESS, COPM_CELO_ADDRESS),
    miniPayAddCash: false,
    hiddenInMiniPay: true,
  },
];

/**
 * Saldo listo para leer. Un polvito de token (más de cero pero menos de lo que
 * se alcanza a mostrar) sale como "<0,01" y no como "0": que el saldo diga
 * cero cuando hay algo es peor que un número feo.
 */
export function formatBalance(
  balance: bigint,
  decimals: number,
  display: number
): string {
  const human = Number(formatUnits(balance, decimals));
  const smallest = Math.pow(10, -display);
  if (balance > 0n && display > 0 && human < smallest) {
    return `<${smallest.toLocaleString("es-CO", {
      minimumFractionDigits: display,
      maximumFractionDigits: display,
    })}`;
  }
  if (balance > 0n && display === 0 && human < 1) return "<1";
  return human.toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: display,
  });
}
