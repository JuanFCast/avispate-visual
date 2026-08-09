// Cuál es TU wallet cuando hay dos candidatas, y qué se puede hacer con la que
// no lo es.
//
// El caso real detrás de esto (PipeRabby, 2026-08-07): entró con la extensión de
// Rabby bloqueada, Privy lo dio por "usuario sin wallets" y le creó una embebida.
// Desde ahí la aplicación tuvo dos direcciones para la misma persona y las
// repartió entre pantallas — estadisticas del perfil (su Rabby, 12 partidas,
// 2.08 USDT) y saldos de la embebida vacia. Mismo perfil, cartera de otro.
//
// Correr: node scripts/verify-wallet-identity.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decideWalletIdentity,
  mayTransact,
  walletToShow,
} from "../lib/wallet-identity.ts";

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

// Las dos direcciones reales del incidente.
const RABBY = "0x46d5f9fe98461928dbad7a22b95bade5fa178c18";
const EMBED = "0xfd43f6003484579ca068313736632eea8c651477";
const OTRA = "0x1111111111111111111111111111111111111111";

console.log("\n— 1. Solo wallet externa (entro firmando) —");
{
  const v = decideWalletIdentity({ canonical: RABBY, connected: RABBY, ready: true });
  check("la conectada es la canonica", v, { kind: "ok", address: RABBY });
  check("puede operar", mayTransact(v), true);
  check("y la pantalla mira esa", walletToShow(v), RABBY);

  // Mayusculas: la misma wallet escrita distinto sigue siendo la misma.
  check(
    "no se confunde por mayusculas",
    decideWalletIdentity({
      canonical: RABBY,
      connected: RABBY.toUpperCase(),
      ready: true,
    }).kind,
    "ok"
  );
}

console.log("\n— 2. Solo wallet embebida (entro por correo) —");
{
  // Su embebida ES su canonica: no hay ninguna externa que respetar.
  const v = decideWalletIdentity({ canonical: EMBED, connected: EMBED, ready: true });
  check("la embebida manda cuando es la suya", v, { kind: "ok", address: EMBED });
  check("puede operar", mayTransact(v), true);
}

console.log("\n— 3. Jugador nuevo: aun no hay canonica —");
{
  const v = decideWalletIdentity({ canonical: null, connected: EMBED, ready: true });
  check("la conectada sera la suya", v, { kind: "no_canonical", address: EMBED });
  // Si esto bloqueara, nadie podria estrenar cuenta.
  check("puede operar igual", mayTransact(v), true);
  check("y la pantalla mira esa", walletToShow(v), EMBED);
}

console.log("\n— 4. EL CASO PIPERABBY: externa historica + embebida accidental —");
{
  // El perfil tiene la Rabby; wagmi tiene conectada la embebida que Privy creo
  // sola. Antes: estadisticas de una, saldos de la otra.
  const v = decideWalletIdentity({ canonical: RABBY, connected: EMBED, ready: true });
  check("no se cambia de identidad", v, {
    kind: "connect_canonical",
    canonical: RABBY,
    connected: EMBED,
  });

  // Las tres cosas que el bug hacia mal, ahora fijadas:
  check("NO se puede pagar ni cobrar", mayTransact(v), false);
  check("la pantalla ensena la CANONICA, no la conectada", walletToShow(v), RABBY);
  check(
    "y desde luego no ensena la embebida",
    walletToShow(v) === EMBED,
    false
  );
}

console.log("\n— 5. Rabby bloqueada o reconectando —");
{
  // Extension bloqueada: hay canonica y no hay nada conectado.
  const bloqueada = decideWalletIdentity({
    canonical: RABBY,
    connected: null,
    ready: true,
  });
  check("se pide conectar la correcta", bloqueada, {
    kind: "connect_canonical",
    canonical: RABBY,
    connected: null,
  });
  check("sin operar mientras tanto", mayTransact(bloqueada), false);
  // Importante: se sigue viendo SU cartera, no un hueco. El saldo es suyo
  // aunque la extension este dormida.
  check("pero su cartera se sigue viendo", walletToShow(bloqueada), RABBY);

  // Reconectando: todavia no se sabe. Falla cerrado y sin parpadeo de avisos.
  const arrancando = decideWalletIdentity({
    canonical: RABBY,
    connected: null,
    ready: false,
  });
  check("mientras arranca no hay veredicto", arrancando, { kind: "unknown" });
  check("y no autoriza nada", mayTransact(arrancando), false);
  check("ni ensena una direccion a medias", walletToShow(arrancando), null);

  // Ni siquiera con la buena conectada: si no terminamos de mirar, no se sabe.
  check(
    "no se adelanta ni con la correcta puesta",
    decideWalletIdentity({ canonical: RABBY, connected: RABBY, ready: false }).kind,
    "unknown"
  );
}

console.log("\n— 6. Cambio REAL de cuenta —");
{
  // El jugador conecta a proposito otra wallet suya. No se le roba la identidad
  // por eso: sigue mandando la del perfil hasta que el cambio sea deliberado.
  const v = decideWalletIdentity({ canonical: RABBY, connected: OTRA, ready: true });
  check("la identidad no se mueve sola", v.kind, "connect_canonical");
  check("no puede operar con la otra", mayTransact(v), false);
  check("los premios siguen apuntando a la canonica", walletToShow(v), RABBY);

  // Y el reverso: quien vuelve a poner la suya, opera de inmediato.
  check(
    "al reconectar la correcta, todo vuelve",
    mayTransact(decideWalletIdentity({ canonical: RABBY, connected: RABBY, ready: true })),
    true
  );
}

console.log("\n— La regla no depende de la sesion ni de wagmi —");
{
  // Cinco entradas distintas de 'conectada' contra la misma canonica: ninguna
  // que no sea la canonica puede operar. Si algun dia alguien mete una
  // excepcion, esto lo caza.
  const conectadas = [null, EMBED, OTRA, "", "  "];
  const permisos = conectadas.map((c) =>
    mayTransact(decideWalletIdentity({ canonical: RABBY, connected: c, ready: true }))
  );
  check("ninguna ajena opera", permisos, [false, false, false, false, false]);
}

console.log("\n— Y esta enchufada donde importa —");
{
  const perfil = readFileSync(join(ROOT, "app/perfil/page.tsx"), "utf8");
  check(
    "el perfil ya no pasa la wallet conectada a la tarjeta",
    /<WalletCard address=\{address\}/.test(perfil),
    false
  );
  check(
    "usa la que manda la regla",
    /walletToShow|shownWallet/.test(perfil),
    true
  );

  const embebida = readFileSync(join(ROOT, "lib/embedded-wallet.tsx"), "utf8");
  check(
    "el listener de proveedores se quita al limpiar",
    /removeEventListener\("eip6963:requestProvider"/.test(embebida),
    true
  );

  // El invariante, no la forma: la EXTERNA se elige primero. Comprobar que ya
  // no existe el patron viejo no serviria — es subcadena del nuevo, porque la
  // embebida sigue siendo el segundo recurso para quien solo entro por correo.
  const servidor = readFileSync(join(ROOT, "lib/privy-server.ts"), "utf8");
  check(
    "el servidor prefiere la wallet EXTERNA del jugador",
    /const wallet = externa \?\?/.test(servidor),
    true
  );
  check(
    "y la externa se identifica por no ser de Privy",
    /walletClientType !== "privy"/.test(servidor),
    true
  );
}

console.log(
  failed === 0 ? "\nTodo bien.\n" : `\n${failed} comprobacion(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
