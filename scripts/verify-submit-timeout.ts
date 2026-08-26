// Ningún envío puede quedarse colgado para siempre.
//
// El fallo (2026-08-26): `postOnce` llamaba a `fetch` sin `signal`. En iOS basta
// con que la webview se suspenda a mitad del envío para que esa promesa no
// vuelva NUNCA, y con ella el botón se queda en "Registrando jugada…" sin
// spinner que se apague ni error que mostrar. La red no tiene la obligación de
// fallar; el tope lo tiene que poner uno.
//
// Se prueba con un `fetch` de mentira que nunca resuelve — el caso exacto que a
// mano exigiría suspender un iPad en el instante justo.
//
// Correr: node scripts/verify-submit-timeout.ts

/** Un `fetch` que se cuelga hasta que lo aborten. */
function fetchColgado(): (url: string, init: { signal: AbortSignal }) => Promise<never> {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new Error("AbortError"))
      );
    });
}

/** Un `fetch` que contesta lo que se le diga, tras `demoraMs`. */
function fetchQueContesta(
  status: number,
  body: unknown,
  demoraMs = 0
) {
  return async () => {
    if (demoraMs) await new Promise((r) => setTimeout(r, demoraMs));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { postWithRetry, BLOCKING_LIMITS, BACKGROUND_LIMITS, REQUEST_TIMEOUT_MS } =
  await import("../lib/submit.ts");

let failed = 0;
function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

const set = (fn: unknown) => {
  (globalThis as Record<string, unknown>).fetch = fn;
};

/* ── 1. Un fetch que nunca vuelve ────────────────────────────────────────── */

console.log("\n— 1. La red se cuelga y el envío vuelve igual —\n");

{
  set(fetchColgado());
  const t0 = Date.now();
  const out = await postWithRetry("/api/plays", {}, [50, 50], {
    requestTimeoutMs: 120,
    totalBudgetMs: 900,
  });
  const ms = Date.now() - t0;
  ok(
    "vuelve en vez de colgarse, y como reintentable",
    out.result === "retry",
    JSON.stringify(out)
  );
  ok(
    `respeta el presupuesto total (tardó ${ms} ms, tope 900)`,
    ms < 1500,
    `${ms} ms`
  );
}

/* ── 2. El presupuesto del envío que retiene al jugador ──────────────────── */

console.log("\n— 2. El que retiene al jugador tiene techo —\n");

{
  ok(
    "el envío bloqueante trae tope por intento y tope total",
    typeof BLOCKING_LIMITS.requestTimeoutMs === "number" &&
      typeof BLOCKING_LIMITS.totalBudgetMs === "number" &&
      BLOCKING_LIMITS.totalBudgetMs! <= 30_000,
    JSON.stringify(BLOCKING_LIMITS)
  );
  ok(
    "el de fondo tiene tope por intento aunque no tenga techo total",
    (BACKGROUND_LIMITS.requestTimeoutMs ?? REQUEST_TIMEOUT_MS) > 0,
    JSON.stringify(BACKGROUND_LIMITS)
  );

  // Con el fetch colgado y los topes REALES del camino bloqueante, el jugador
  // no puede quedarse mirando el spinner más de lo prometido.
  set(fetchColgado());
  const t0 = Date.now();
  const out = await postWithRetry("/api/plays", {}, [1000, 2000, 4000, 8000], BLOCKING_LIMITS);
  const ms = Date.now() - t0;
  ok(
    `con los topes reales sale en ${(ms / 1000).toFixed(1)} s, no en 75`,
    out.result === "retry" && ms <= (BLOCKING_LIMITS.totalBudgetMs ?? 0) + 2000,
    `${ms} ms`
  );
}

/* ── 3. Que el tope no se coma una respuesta buena ───────────────────────── */

console.log("\n— 3. Un servidor lento pero vivo sigue funcionando —\n");

{
  set(fetchQueContesta(200, { ok: true, seed: "s-1" }, 60));
  const out = await postWithRetry("/api/plays", {}, [], { requestTimeoutMs: 800 });
  ok(
    "responde a tiempo → ok, con su semilla",
    out.result === "ok" && (out.data as { seed?: string })?.seed === "s-1",
    JSON.stringify(out)
  );
}

/* ── 4. Los códigos nuevos, que es lo que decide si algo se conserva ─────── */

console.log("\n— 4. Cada código, con el resultado que le toca —\n");

{
  const casos: Array<[string, number, string, string]> = [
    ["payment_reverted", 409, "rejected", "se borra: la cadena dice que no cobró"],
    ["payment_pending", 409, "retry", "se conserva: está en vuelo"],
    ["payment_unknown", 409, "retry", "se conserva: decide la persona"],
    ["chain_unavailable", 503, "retry", "se conserva: no se pudo preguntar"],
    ["invalid_payment", 400, "retry", "se conserva: como siempre"],
    ["payer_mismatch", 409, "retry", "se conserva: falta reconciliar"],
    ["server_error", 500, "retry", "se conserva"],
    ["alias_taken", 409, "retry", "se conserva: entra al elegir nombre"],
  ];
  for (const [code, status, esperado, porque] of casos) {
    set(fetchQueContesta(status, { error: code }));
    const out = await postWithRetry("/api/plays", {}, [], { requestTimeoutMs: 500 });
    ok(
      `${code} (${status}) → ${esperado} — ${porque}`,
      out.result === esperado && out.error === code,
      JSON.stringify(out)
    );
  }

  // Un 503 sin código propio sigue siendo reintentable, como antes.
  set(fetchQueContesta(503, null));
  const sinCodigo = await postWithRetry("/api/plays", {}, [], { requestTimeoutMs: 500 });
  ok("503 sin cuerpo → retry", sinCodigo.result === "retry", JSON.stringify(sinCodigo));

  // Y un rechazo de verdad sigue siendo rechazo.
  set(fetchQueContesta(400, { error: "invalid_tx_hash" }));
  const malo = await postWithRetry("/api/plays", {}, [], { requestTimeoutMs: 500 });
  ok(
    "invalid_tx_hash → rejected (no tiene sentido reintentarlo)",
    malo.result === "rejected",
    JSON.stringify(malo)
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);

export {};
