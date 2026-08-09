/**
 * Un freno de mano para rutas que trabajan sin sesión.
 *
 * Es una ventana deslizante en memoria del proceso, y hay que decir lo que NO
 * es: no es un límite global. Cada instancia serverless lleva su propia cuenta,
 * así que un atacante repartido entre varias las pasa todas. Lo que sí para es
 * lo que de verdad se ve en producción —un cliente en bucle, un reintento mal
 * escrito, una sola máquina martillando— y eso basta para que una ruta abierta
 * no se convierta en un grifo de peticiones al RPC.
 *
 * Se queda aquí, pequeño y honesto, hasta que haya un límite compartido de
 * verdad. Fingir que esto lo es sería peor que no tenerlo.
 */

/** Marcas de tiempo de las últimas llamadas de cada clave. */
const hits = new Map<string, number[]>();

/** Cuántas claves se guardan antes de barrer las que ya no cuentan. */
const MAX_KEYS = 5_000;

export interface RateLimit {
  /** Llamadas permitidas dentro de la ventana. */
  limit: number;
  /** Tamaño de la ventana. */
  windowMs: number;
}

/**
 * ¿Esta clave puede pasar? Cuenta la llamada si la respuesta es que sí.
 */
export function allow(
  key: string,
  { limit, windowMs }: RateLimit,
  now = Date.now()
): boolean {
  const since = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > since);

  if (recent.length >= limit) {
    // Se guarda igual para que el que insiste siga viendo la puerta cerrada
    // durante toda la ventana en vez de renovarla con cada intento.
    hits.set(key, recent);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);

  // Barrido perezoso: sin esto el mapa crece con cada IP que pase una vez.
  if (hits.size > MAX_KEYS) {
    for (const [k, times] of hits) {
      if (times.every((t) => t <= since)) hits.delete(k);
    }
  }

  return true;
}

/**
 * De dónde viene la petición, según las cabeceras del proxy. Es orientativo —
 * se puede falsear— y por eso solo se usa para repartir un límite, nunca para
 * decidir un permiso.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "desconocido";
}
