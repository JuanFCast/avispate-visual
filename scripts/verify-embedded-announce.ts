// La wallet embebida NO es un conector declarado en `lib/wagmi.ts`: llega a
// wagmi únicamente por el anuncio EIP-6963 de `lib/embedded-wallet.tsx`. Si ese
// anuncio se pierde, wagmi se queda sin conector con el que firmar, el efecto
// de conexión reintenta ocho veces contra algo que no existe, y el botón de
// jugar se queda deshabilitado en "preparando tu billetera" — gratis y pagando,
// en Chrome y en Safari. Si en cambio se rehace de más, quedan varias closures
// vivas anunciando proveedores muertos y wagmi puede reconectar uno anterior:
// la intermitencia de "a veces sale una dirección y a veces otra".
//
// La regla es una sola: UN anuncio, UN uuid y UN oyente por dirección embebida.
// Aquí se recorren secuencias enteras de renders y se comprueba que converge.
//
// Correr: node scripts/verify-embedded-announce.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideEmbeddedAnnounce,
  embeddedAnnounceUuid,
  EMBEDDED_WALLET_NAME,
} from "../lib/wallet-identity.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(
    `${condition ? "  ok  " : " FALLA"} ${name}${condition ? "" : `\n         ${detail}`}`
  );
}

/* ── Un navegador de mentira, con lo justo: oyentes y eventos ───────────── */

class VentanaFalsa {
  listeners: Array<() => void> = [];
  /** Cada anuncio que llegó a despacharse, con el uuid que llevaba. */
  anuncios: string[] = [];

  addEventListener(_tipo: string, fn: () => void) {
    this.listeners.push(fn);
  }
  removeEventListener(_tipo: string, fn: () => void) {
    const i = this.listeners.indexOf(fn);
    if (i !== -1) this.listeners.splice(i, 1);
  }
  /** Lo que hace wagmi al arrancar (y al remontarse): pedir proveedores. */
  requestProvider(): number {
    const antes = this.anuncios.length;
    for (const fn of [...this.listeners]) fn();
    return this.anuncios.length - antes;
  }
}

/**
 * El ejecutor de `embedded-wallet.tsx`, con la MISMA forma: un ref con el
 * anuncio vivo, un turno contra resoluciones solapadas, y una decisión pura
 * que dice qué hacer. Abajo se comprueba contra el archivo real que la forma
 * sigue siendo esta.
 */
function crearProveedorEmbebido(ventana: VentanaFalsa) {
  let anuncio: { address: string; listener: () => void } | null = null;
  let turno = 0;
  /** Resoluciones de proveedor pendientes, para poder ordenarlas a mano. */
  const pendientes: Array<() => void> = [];

  const retirar = () => {
    if (!anuncio) return;
    ventana.removeEventListener("eip6963:requestProvider", anuncio.listener);
    anuncio = null;
  };

  /** Un render: Privy expone `embeddedAddress` (o null). */
  const render = (embeddedAddress: string | null, demoraProveedor = false) => {
    const accion = decideEmbeddedAnnounce({
      embeddedAddress,
      announced: anuncio?.address ?? null,
    });
    if (accion.kind === "keep") return accion.kind;
    if (accion.kind === "retract") {
      retirar();
      return accion.kind;
    }

    const mio = ++turno;
    const resolver = () => {
      if (mio !== turno) return;
      retirar();
      const uuid = embeddedAnnounceUuid(accion.address);
      const announce = () => ventana.anuncios.push(uuid);
      ventana.addEventListener("eip6963:requestProvider", announce);
      anuncio = { address: accion.address, listener: announce };
      announce();
    };
    if (demoraProveedor) pendientes.push(resolver);
    else resolver();
    return accion.kind;
  };

  return {
    render,
    desmontar: retirar,
    resolverPendientes: () => {
      for (const fn of pendientes.splice(0)) fn();
    },
    vivo: () => anuncio?.address ?? null,
  };
}

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/* ── 1. El anuncio SOBREVIVE a los renders ──────────────────────────────── */

console.log("\n— 1. Privy devuelve otro objeto en cada render; la wallet es la misma —\n");

{
  const ventana = new VentanaFalsa();
  const app = crearProveedorEmbebido(ventana);

  // 50 renders con la MISMA dirección: es lo que pasa de verdad, porque el
  // reloj de la ronda repinta cada segundo y el perfil se recarga solo.
  for (let i = 0; i < 50; i++) app.render(A);

  ok(
    "se anuncia una sola vez, no cincuenta",
    ventana.anuncios.length === 1,
    `hubo ${ventana.anuncios.length} anuncios`
  );
  ok(
    "queda EXACTAMENTE un oyente vivo",
    ventana.listeners.length === 1,
    `${ventana.listeners.length} oyentes`
  );
  ok(
    "y la app sigue contestando cuando wagmi pide proveedores",
    ventana.requestProvider() === 1,
    "nadie contestó: wagmi se queda sin el conector de la embebida"
  );
}

/* ── 2. Cambio de dirección: se reemplaza, no se acumula ────────────────── */

console.log("\n— 2. La embebida cambia de dirección —\n");

{
  const ventana = new VentanaFalsa();
  const app = crearProveedorEmbebido(ventana);
  app.render(A);
  app.render(B);
  app.render(B);

  ok("el anuncio vivo es el de la dirección nueva", app.vivo() === B);
  ok(
    "sigue habiendo un solo oyente — el viejo se retiró",
    ventana.listeners.length === 1,
    `${ventana.listeners.length} oyentes`
  );

  ventana.anuncios.length = 0;
  ventana.requestProvider();
  ok(
    "y al pedir proveedores contesta SOLO la wallet actual",
    ventana.anuncios.length === 1 &&
      ventana.anuncios[0] === embeddedAnnounceUuid(B),
    JSON.stringify(ventana.anuncios)
  );
}

/* ── 3. Se va la embebida (cerrar sesión) ───────────────────────────────── */

console.log("\n— 3. Deja de haber embebida —\n");

{
  const ventana = new VentanaFalsa();
  const app = crearProveedorEmbebido(ventana);
  app.render(A);
  app.render(null);

  ok("no queda anuncio vivo", app.vivo() === null);
  ok("ni oyentes sueltos", ventana.listeners.length === 0);
  ok(
    "y ya nadie contesta por una wallet que no está",
    ventana.requestProvider() === 0
  );
}

/* ── 4. MiniPay: nunca hay embebida que anunciar ────────────────────────── */

console.log("\n— 4. MiniPay: manda la inyectada, aquí no se anuncia nada —\n");

{
  const ventana = new VentanaFalsa();
  const app = crearProveedorEmbebido(ventana);
  for (let i = 0; i < 20; i++) app.render(null);

  ok("cero anuncios", ventana.anuncios.length === 0);
  ok("cero oyentes", ventana.listeners.length === 0);
  ok(
    "y la decisión es siempre 'keep', sin trabajo que hacer",
    decideEmbeddedAnnounce({ embeddedAddress: null, announced: null }).kind ===
      "keep"
  );
}

/* ── 5. Dos proveedores resolviendo a la vez ────────────────────────────── */

console.log("\n— 5. La wallet vieja contesta TARDE, cuando ya hay otra —\n");

{
  const ventana = new VentanaFalsa();
  const app = crearProveedorEmbebido(ventana);

  // A pide su proveedor y tarda; entre tanto llega B y resuelve enseguida.
  app.render(A, true);
  app.render(B);
  // Ahora sí contesta el proveedor de A, tarde.
  app.resolverPendientes();

  ok(
    "la respuesta tardía de la wallet vieja NO pisa a la actual",
    app.vivo() === B,
    `quedó ${app.vivo()}`
  );
  ok("y no deja un oyente de más", ventana.listeners.length === 1);
}

/* ── 6. Desmontar ───────────────────────────────────────────────────────── */

console.log("\n— 6. Al desmontar no queda nada colgado —\n");

{
  const ventana = new VentanaFalsa();
  const app = crearProveedorEmbebido(ventana);
  app.render(A);
  app.desmontar();

  ok("sin oyentes", ventana.listeners.length === 0);
  ok("sin anuncio vivo", app.vivo() === null);
}

/* ── 7. El uuid: el mismo por wallet, siempre ───────────────────────────── */

console.log("\n— 7. Un uuid por wallet: anunciar de más es idempotente —\n");

{
  ok(
    "la misma dirección da siempre el mismo uuid",
    embeddedAnnounceUuid(A) === embeddedAnnounceUuid(A)
  );
  ok(
    "no lo cambia escribirla en mayúsculas",
    embeddedAnnounceUuid(A) === embeddedAnnounceUuid(A.toUpperCase())
  );
  ok(
    "dos wallets distintas dan uuids distintos",
    embeddedAnnounceUuid(A) !== embeddedAnnounceUuid(B)
  );
  const forma =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  ok(
    "y tiene la forma de UUIDv4 que exige EIP-6963",
    forma.test(embeddedAnnounceUuid(A)) && forma.test(embeddedAnnounceUuid(B)),
    `${embeddedAnnounceUuid(A)} / ${embeddedAnnounceUuid(B)}`
  );

  // Irse y volver (relogin) tiene que dar el MISMO conector, no uno nuevo.
  const ventana = new VentanaFalsa();
  const app = crearProveedorEmbebido(ventana);
  app.render(A);
  app.render(null);
  app.render(A);
  ok(
    "irse y volver reusa el mismo conector en wagmi, no crea otro",
    new Set(ventana.anuncios).size === 1,
    JSON.stringify(ventana.anuncios)
  );
}

/* ── 8. El código real conserva la forma que se acaba de probar ─────────── */

console.log("\n— 8. Y el efecto de verdad sigue teniendo esta forma —\n");

{
  const fuente = readFileSync(join(ROOT, "lib/embedded-wallet.tsx"), "utf8")
    .replace(/\r\n/g, "\n");

  ok(
    "la decisión la toma `decideEmbeddedAnnounce`, no un `if` a mano",
    /const accion = decideEmbeddedAnnounce\(\{/.test(fuente)
  );
  ok(
    "se compara por DIRECCIÓN anunciada, no por identidad del objeto de Privy",
    /announced: anuncioRef\.current\?\.address \?\? null/.test(fuente)
  );
  ok(
    "el uuid sale de la dirección, nunca de `crypto.randomUUID()`",
    /uuid: embeddedAnnounceUuid\(accion\.address\)/.test(fuente) &&
      !/randomUUID/.test(fuente)
  );

  /**
   * Lo que NO puede volver: que el efecto retire el anuncio al re-renderizarse.
   * Ese `return () => …` dentro del efecto del anuncio es justo lo que dejaba a
   * la app muda para el resto de la sesión. Retirar solo puede ocurrir por
   * `retract` (ya no hay wallet), al reemplazar, o al desmontar.
   */
  const inicio = fuente.indexOf("const accion = decideEmbeddedAnnounce({");
  const fin = fuente.indexOf("}, [embedded, embeddedAddress, retirarAnuncio]);", inicio);
  const cuerpo = inicio !== -1 && fin !== -1 ? fuente.slice(inicio, fin) : "";
  ok("se pudo aislar el cuerpo del efecto", cuerpo.length > 0);
  ok(
    "el efecto del anuncio NO devuelve limpieza (no se retira al re-renderizar)",
    cuerpo.length > 0 && !/return \(\) =>/.test(cuerpo),
    cuerpo
  );
  ok(
    "retirar al desmontar sí existe, y en su propio efecto",
    /useEffect\(\(\) => retirarAnuncio, \[retirarAnuncio\]\);/.test(fuente)
  );
  ok(
    "hay turno contra dos proveedores resolviendo a la vez",
    /turno !== anuncioSeqRef\.current/.test(fuente)
  );
}

/* ── 9. En MiniPay se conecta la del teléfono, nunca la embebida ────────── */

console.log("\n— 9. MiniPay elige la inyectada del teléfono, no la embebida —\n");

{
  /**
   * El caso real: alguien con cuenta de correo (y su embebida) abre el Mini
   * App. Anunciamos la embebida, así que wagmi tiene DOS conectores de tipo
   * "injected". El de MiniPay tiene que ganar siempre — no por orden en la
   * lista, que no es una promesa, sino porque la embebida se descarta.
   */
  const elegir = (conectores: Array<{ id: string; type: string; name: string }>) =>
    conectores.find(
      (c) =>
        c.name !== EMBEDDED_WALLET_NAME &&
        (c.id === "injected" || c.type === "injected")
    );

  const embebida = { id: "fun.avispate.embedded", type: "injected", name: EMBEDDED_WALLET_NAME };
  const minipay = { id: "injected", type: "injected", name: "Injected" };

  ok(
    "con la embebida PRIMERO en la lista, sigue ganando la de MiniPay",
    elegir([embebida, minipay])?.name === minipay.name,
    JSON.stringify(elegir([embebida, minipay]))
  );
  ok(
    "y con la embebida después, también",
    elegir([minipay, embebida])?.name === minipay.name
  );
  ok(
    "si NO hay inyectada del teléfono, no se conecta la embebida por descarte",
    elegir([embebida]) === undefined,
    "conectaría la wallet equivocada dentro de MiniPay"
  );

  const minipaySrc = readFileSync(join(ROOT, "lib/minipay.ts"), "utf8").replace(
    /\r\n/g,
    "\n"
  );
  ok(
    "y `useMiniPayAutoConnect` de verdad descarta la embebida por nombre",
    /c\.name !== EMBEDDED_WALLET_NAME/.test(minipaySrc)
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
