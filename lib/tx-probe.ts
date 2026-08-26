/**
 * Preguntarle a CADA nodo de Celo si conoce un hash.
 *
 * Vive aparte de `onchain.ts` a propósito: esto lo usan los dos lados. El
 * servidor, para no contestar "pago inválido" a una transacción que solo está
 * en vuelo; y el navegador, para no pasar a "Registrando jugada…" con un hash
 * que la wallet devolvió y la red nunca vio. Aquí no hay viem ni ABIs, así que
 * el cliente no arrastra nada por incluirlo.
 *
 * La regla de qué significan las respuestas juntas es pura y vive en
 * `tx-presence.ts`; esto solo es el transporte.
 */

import { CELO_RPC_URLS } from "./chain.ts";
import {
  decideTxPresence,
  type NodeAnswer,
  type TxPresence,
} from "./tx-presence.ts";

/**
 * Cuánto se espera a UN nodo. Corto a propósito: se les pregunta a todos a la
 * vez y con dos respuestas ya hay consenso, así que el lento no puede arrastrar
 * a los demás.
 */
export const NODE_TIMEOUT_MS = 6_000;

/** Una llamada JSON-RPC pelada. Lanza si el nodo no contesta o contesta error. */
async function rpc(
  url: string,
  method: string,
  params: unknown[]
): Promise<unknown> {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), NODE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: unknown };
    if (json.error) throw new Error("rpc_error");
    return json.result ?? null;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Qué sabe UN nodo de este hash. Se pregunta primero por el recibo y solo si no
 * lo tiene por la transacción: un nodo puede conocerla sin haberla minado, y esa
 * diferencia es justo la que separa "está en vuelo" de "no existe".
 */
async function askNode(url: string, txHash: string): Promise<NodeAnswer> {
  try {
    if (await rpc(url, "eth_getTransactionReceipt", [txHash])) return "receipt";
    return (await rpc(url, "eth_getTransactionByHash", [txHash]))
      ? "known"
      : "unknown";
  } catch {
    // No contestó. NO es "no existe", y confundir las dos cosas es como se
    // pierde una jugada pagada.
    return "unreachable";
  }
}

/**
 * ¿Existe esta transacción en la red? Se les pregunta a todos los nodos a la
 * vez y decide `decideTxPresence`, que exige consenso para dar algo por
 * inexistente.
 */
export async function probeTxPresence(txHash: string): Promise<TxPresence> {
  const answers = await Promise.all(
    CELO_RPC_URLS.map((url) => askNode(url, txHash))
  );
  return decideTxPresence(answers);
}
