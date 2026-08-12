"use client";

/**
 * Lo que cualquier transacción firmada por el jugador necesita para portarse
 * bien dentro de MiniPay: con qué moneda paga el gas, y cuánto se espera antes
 * de tratar un recibo lento como un fallo.
 *
 * Vive aparte de `pay.ts` porque ya no es solo del reto diario: la Arena firma
 * sus propias transacciones (`approve` + `join` del escrow) y necesita la
 * MISMA política, no una copia que un día se desincroniza de la original.
 */

import { CIP64_FEE_ADAPTER } from "./contracts.ts";

/** Lo mínimo que necesitamos de un cliente público para decidir el gas. */
export interface BalanceReader {
  getBalance: (args: { address: `0x${string}` }) => Promise<bigint>;
  getGasPrice: () => Promise<bigint>;
}

/**
 * Cuánto de más se exige tener por encima del costo de UNA transacción antes
 * de dar el CELO por suficiente. El precio del gas se mueve entre que se lee y
 * que se firma; quedarse justo es quedarse corto.
 */
export const GAS_SAFETY = 5n; // se divide entre 4 → x1.25

/**
 * Cuánto se espera a que una transacción aparezca confirmada en la cadena.
 *
 * El valor por defecto de viem son 180 s (tres minutos mirando un spinner).
 * En Celo un bloque tarda ~1 s: si a los 20 s no se ve, no es que la
 * transacción vaya a fallar, es que el sondeo se tropezó — típico dentro de
 * MiniPay, cuya webview se suspende mientras muestra la hoja de firma.
 */
export const RECEIPT_TIMEOUT_MS = 20_000;

/**
 * Con qué se paga la tarifa de red de una transacción firmada por el jugador.
 *
 * En MiniPay SIEMPRE en USDT (su CELO es 0 por diseño). Fuera de MiniPay, se
 * paga en CELO mientras alcance, y en USDT (CIP-64) cuando no.
 *
 * "Cuando no alcance" se calcula con el precio del gas del momento y el
 * `gasLimit` de la transacción MÁS CARA de la secuencia que se está por
 * firmar (una sola lectura decide el gas de todas, igual que ya hacía el reto
 * diario con `approve` + `play`). Antes había un número fijo —0.01 CELO— que
 * venía de cuando el gas en Celo costaba unos pocos gwei. Hoy cuesta ~200, y
 * una jugada vale ~0.017 CELO: el umbral se quedó POR DEBAJO del precio de una
 * transacción. Eso abría una franja donde la app decidía "tiene CELO de
 * sobra", firmaba en CELO y la red la rechazaba por fondos insuficientes.
 *
 * Vive aquí y no repetido en cada flujo de pago: el reto diario y la Arena
 * deben decidirlo igual, o un día uno de los dos se queda sin con qué pagar
 * mientras el otro funciona.
 *
 * `inMiniPay` entra como dato, no se lee aquí con `isMiniPay()`: así la
 * función queda pura —sin `window`— y `scripts/verify-arena-fee-currency.ts`
 * puede recorrer el caso "MiniPay con 0 CELO" sin un navegador de por medio.
 */
export async function resolveFeeCurrency(
  publicClient: BalanceReader,
  address: `0x${string}`,
  gasLimit: bigint,
  inMiniPay: boolean
): Promise<{ feeCurrency?: `0x${string}` }> {
  let payFeeInUsdt = inMiniPay;
  if (!payFeeInUsdt) {
    const [celoBalance, gasPrice] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.getGasPrice(),
    ]);
    const needed = (gasLimit * gasPrice * GAS_SAFETY) / 4n;
    payFeeInUsdt = celoBalance < needed;
  }
  return payFeeInUsdt
    ? { feeCurrency: CIP64_FEE_ADAPTER as `0x${string}` }
    : {};
}
