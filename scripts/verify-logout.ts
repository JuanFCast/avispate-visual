// Cerrar sesion: que el navegador deje de ser nadie, sin quemarle dinero a
// nadie por el camino.
//
// Lo que se persigue: PipeRabby cierra sesion, conecta 0xBBBB, y entra al perfil
// de 0xBBBB — nunca al de PipeRabby con otra wallet dentro. La regla estricta
// (1 perfil = 1 wallet) NO se afloja; lo que se termina es la sesion.
//
// Y la linea que no se cruza: se borra IDENTIDAD y CONEXION, nunca DINERO. El
// secreto de una silla es la unica forma de reclamar una entrada ya pagada.
//
// Correr: node scripts/verify-logout.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  keysToClearOnLogout,
  logoutEverything,
  MONEY_PREFIXES,
} from "../lib/logout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FALLA"} ${name}` +
      (ok
        ? ""
        : `\n         esperado ${JSON.stringify(expected)}` +
          `\n         recibido ${JSON.stringify(actual)}`)
  );
}

// Una foto realista de `localStorage` con sesion viva.
const GUARDADO = [
  // identidad y conexion
  "avispate.wallet-session",
  "avispateSeatToken_v1:MY37GV",
  "wagmi.store",
  "wagmi.recentConnectorId",
  "wc@2:client:0.3//session",
  "WALLETCONNECT_DEEPLINK_CHOICE",
  "@w3m/connected_wallet_image_url",
  "@appkit/portfolio_cache",
  "reown_connected",
  "privy:token",
  // dinero
  "avispateSeat_v1:0xaaa1",
  "avispateSeatPaid_v1:MY37GV",
  "avispateOutbox_v1",
  // ajenos: ni se tocan
  "avispate.muted",
  "avispateAlias_0x46d5",
  "theme",
];

console.log("\n— Se va la identidad —");
{
  const fuera = keysToClearOnLogout(GUARDADO);
  for (const k of [
    "avispate.wallet-session",
    "wagmi.store",
    "wagmi.recentConnectorId",
    "wc@2:client:0.3//session",
    "WALLETCONNECT_DEEPLINK_CHOICE",
    "@w3m/connected_wallet_image_url",
    "@appkit/portfolio_cache",
    "reown_connected",
    "privy:token",
  ]) {
    check(`se borra ${k}`, fuera.includes(k), true);
  }

  // Esta es la que mantenia viva a PipeRabby despues del logout de Privy:
  // `ProfileProvider` hace `authenticated = privyAuth || walletSession`.
  check(
    "la sesion sin firma NO sobrevive",
    fuera.includes("avispate.wallet-session"),
    true
  );

  // Permiso, no prueba de pago: su dueno la recupera con el secreto.
  check(
    "la ficha de silla se borra (es un permiso)",
    fuera.includes("avispateSeatToken_v1:MY37GV"),
    true
  );
}

console.log("\n— NO se va el dinero —");
{
  const fuera = keysToClearOnLogout(GUARDADO);
  check(
    "el secreto de la silla se queda",
    fuera.includes("avispateSeat_v1:0xaaa1"),
    false
  );
  check(
    "el pago sin registrar se queda",
    fuera.includes("avispateSeatPaid_v1:MY37GV"),
    false
  );
  check("la bandeja se queda", fuera.includes("avispateOutbox_v1"), false);

  // El detalle que lo hace peligroso: `avispateSeat_v1:` y
  // `avispateSeatToken_v1:` empiezan igual hasta la novena letra. Un prefijo mal
  // escrito se lleva el secreto por delante y con el, una entrada pagada.
  check(
    "no se confunde el secreto con la ficha",
    keysToClearOnLogout(["avispateSeat_v1:x", "avispateSeatToken_v1:x"]),
    ["avispateSeatToken_v1:x"]
  );

  // Ninguna clave de dinero puede salir jamas, se combine como se combine.
  const nunca = MONEY_PREFIXES.flatMap((p) => [p, `${p}algo`, `${p}0xABC`]);
  check("ninguna clave de dinero sale nunca", keysToClearOnLogout(nunca), []);
}

console.log("\n— Lo ajeno ni se toca —");
{
  const fuera = keysToClearOnLogout(GUARDADO);
  check("el silencio se queda", fuera.includes("avispate.muted"), false);
  check("el tema se queda", fuera.includes("theme"), false);
  check("y nada que no se le pidiera", fuera.includes("avispateAlias_0x46d5"), false);
}

console.log("\n— El orden, y que nada pueda saltarse la recarga —");
{
  const pasos: string[] = [];
  await logoutEverything({
    privyLogout: async () => { pasos.push("privy"); },
    disconnect: () => { pasos.push("wagmi"); },
    storageKeys: () => ["avispate.wallet-session", "avispateSeat_v1:x"],
    removeKey: (k) => { pasos.push(`borra:${k}`); },
    reload: () => { pasos.push("recarga"); },
  });
  check("recorrido completo", pasos, [
    "wagmi",
    "privy",
    "borra:avispate.wallet-session",
    "recarga",
  ]);
  check("la recarga va la ULTIMA", pasos[pasos.length - 1], "recarga");
}

console.log("\n— Un paso roto no puede dejar el logout a medias —");
{
  // Un logout a medias es peor que ninguno: deja al jugador creyendo que salio.
  const pasos: string[] = [];
  await logoutEverything({
    privyLogout: async () => { throw new Error("privy caido"); },
    disconnect: () => { throw new Error("wagmi caido"); },
    storageKeys: () => ["avispate.wallet-session"],
    removeKey: (k) => { pasos.push(`borra:${k}`); },
    reload: () => { pasos.push("recarga"); },
  });
  check(
    "se limpia y se recarga igual",
    pasos,
    ["borra:avispate.wallet-session", "recarga"]
  );

  // localStorage bloqueado (modo privado): la recarga sigue siendo obligatoria.
  const pasos2: string[] = [];
  await logoutEverything({
    privyLogout: async () => {},
    disconnect: () => {},
    storageKeys: () => { throw new Error("bloqueado"); },
    removeKey: () => {},
    reload: () => { pasos2.push("recarga"); },
  });
  check("y con el almacenamiento bloqueado tambien", pasos2, ["recarga"]);
}

console.log("\n— El callejon sin salida del lobby —");
{
  // `profile.authenticated` es `privyAuth || walletSession`. Con la sesion sin
  // firma suelta en el almacenamiento —la que nadie limpiaba al cerrar sesion—
  // el perfil decia "hay sesion", Privy decia que no (status "idle") y sin
  // wallet conectada el CTA se quedaba en "Preparando..." PARA SIEMPRE. No
  // habia nada cargando: era una contradiccion entre dos formas de contestar la
  // misma pregunta, y por eso ningun tiempo de espera la destrababa.
  const lobby = readFileSync(join(ROOT, "components/lobby/HomeLobby.tsx"), "utf8");
  const rama = lobby.slice(lobby.indexOf('embeddedWallet.status === "idle"'));
  const hastaElFinal = rama.slice(0, rama.indexOf('embeddedWallet.status === "external"'));

  check(
    "sin sesion de Privy ya no se espera en seco",
    /if \(embeddedWallet\.status === "idle"\) return checking;/.test(lobby),
    false
  );
  check(
    "se ofrece entrar",
    /cta\.login\.label/.test(hastaElFinal),
    true
  );
  check(
    "y el boton hace algo",
    /action: "access"/.test(hastaElFinal),
    true
  );
  // Lo unico que sigue justificando esperar ahi: que wagmi este reenganchando
  // de verdad. Eso si es esperar a algo, y ademas ya caduca.
  check(
    "salvo que wagmi siga reenganchando",
    /wallet\.reconnecting\) return checking/.test(hastaElFinal),
    true
  );
}

console.log("\n— Enchufado en el boton —");
{
  const perfil = readFileSync(join(ROOT, "app/perfil/page.tsx"), "utf8");
  check("el boton usa el logout completo", /logoutEverything\(\{/.test(perfil), true);
  // `router.push` no recarga: los proveedores sobreviven con su estado en
  // memoria y pueden reescribir lo que se acaba de borrar.
  check(
    "ya no navega sin recargar",
    /router\.push\("\/"\)/.test(perfil),
    false
  );
  check(
    "recarga entera y sin dejar historial",
    /window\.location\.replace\("\/"\)/.test(perfil),
    true
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobacion(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
