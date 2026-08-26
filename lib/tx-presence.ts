/**
 * ¿Existe esta transacción, y en qué estado?
 *
 * Nace de un fallo que costó dos días: la app daba por buena una transacción
 * que la wallet decía haber enviado y que NUNCA llegó a la red. El servidor
 * respondía `invalid_payment` —un error reintentable— y la jugada se quedaba 48
 * horas en la bandeja del dispositivo reintentándose contra un hash inexistente,
 * sin forma de salir desde la app.
 *
 * Arreglarlo no es "borrar lo que no se encuentra": eso es exactamente cómo se
 * pierde una jugada pagada. Es SABER DISTINGUIR, y para distinguir hace falta
 * separar dos cosas que un solo nodo confunde:
 *
 *   - "este hash no existe"  → el nodo contestó y no lo tiene.
 *   - "no pude preguntar"    → el nodo no contestó.
 *
 * `viem` no sirve para esto y por eso hay reglas propias: su transporte
 * `fallback` solo pasa al siguiente nodo cuando el transporte FALLA. Un recibo
 * nulo es una respuesta correcta a nivel de transporte, así que un nodo
 * atrasado que dice "no lo tengo" corta la cadena de failover y su respuesta se
 * toma como verdad. Aquí se les pregunta a todos y se compara.
 *
 * Puro: sin red, sin `window`, sin viem. Los nodos se consultan fuera y aquí
 * solo llegan sus respuestas (ver `scripts/verify-tx-presence.ts`).
 */

/** Lo que contestó UN nodo cuando se le preguntó por un hash. */
export type NodeAnswer =
  /** Tiene el recibo: la transacción está minada. */
  | "receipt"
  /** Conoce la transacción pero aún no tiene recibo: está en vuelo. */
  | "known"
  /** Contestó, y no sabe nada de ese hash. */
  | "unknown"
  /** No contestó (error de red, tiempo agotado, respuesta ilegible). */
  | "unreachable";

/** El veredicto de todos los nodos juntos. */
export type TxPresence =
  /** Al menos un nodo tiene el recibo. Hay que leerlo y ver si revirtió. */
  | "mined"
  /** Alguien la conoce y nadie la tiene minada: sigue en vuelo. */
  | "pending"
  /** Varios nodos coinciden en que no existe. */
  | "unknown"
  /** No hubo respuestas suficientes para afirmar nada. */
  | "unavailable";

/**
 * Cuántos nodos tienen que decir "no lo tengo" para creerles.
 *
 * Dos, no uno. Un solo nodo atrasado diciendo que no conoce un hash es la
 * situación NORMAL durante los primeros segundos de una transacción; tomarlo
 * por "no existe" es justo el error que deja a alguien sin su jugada.
 */
export const MIN_NODES_FOR_UNKNOWN = 2;

/**
 * El veredicto conjunto. El orden de las reglas es la parte importante:
 *
 * 1. Un solo "lo tengo minado" gana sobre cualquier cantidad de negativas: los
 *    nodos van a distinta altura y el que va adelante es el que sabe.
 * 2. Un solo "la conozco" gana sobre las negativas, por lo mismo.
 * 3. "No existe" necesita CONSENSO, y solo cuenta a los que contestaron.
 * 4. Y si no hubo consenso, la respuesta es "no lo sé" — que NO es "no existe"
 *    y por eso no autoriza a descartar nada.
 */
export function decideTxPresence(answers: readonly NodeAnswer[]): TxPresence {
  if (answers.includes("receipt")) return "mined";
  if (answers.includes("known")) return "pending";
  const negaron = answers.filter((a) => a === "unknown").length;
  if (negaron >= MIN_NODES_FOR_UNKNOWN) return "unknown";
  return "unavailable";
}
