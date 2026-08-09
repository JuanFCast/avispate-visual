// Duelos ganados: que la cifra cuente CARRERAS y no jugadas.
//
// La cifra anterior ("Manos tomadas") era la suma de `correct`, o sea cada carta
// que alguien puso sobre la base. En una partida donde nadie competía por nada
// subía igual: contaba jugadas normales. Un duelo es otra cosa — dos van a por
// la misma carta casi a la vez y el servidor decide quién llegó primero.
//
// ── Qué puede y qué NO puede comprobar este guion ──────────────────────────
//
// La regla vive en `arena_apply_move`, en SQL, y tiene que vivir ahí: un duelo
// solo se distingue dentro del cerrojo, que es el único sitio donde consta
// quién se llevó la base y en qué instante del reloj DEL SERVIDOR. Sin una base
// de datos y dos clientes reales no se puede ejercitar de verdad.
//
// Lo que sí se puede hacer, y es lo que hace este guion, es fijar cada
// condición cuya desaparición volvería la cifra mentirosa otra vez. Todas son
// silenciosas: ninguna rompe nada, solo hacen que el número deje de significar
// lo que dice. En particular la primera, que ya estuvo a punto de pasar.
//
// Correr: node scripts/verify-arena-duels.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

const sql = leer("supabase/migrations/20260809000000_arena_duels.sql");
const matches = leer("lib/supabase/arena-matches.ts");
const vista = leer("components/arena/ArenaMatchOver.tsx");
const dict = leer("lib/i18n/dictionary.ts");
const tipos = leer("lib/arena-match.ts");

console.log("\n— Lo primero: el `stale` TIENE que llegar al cerrojo —");
{
  // Esta es la que mata la funcion entera sin romper nada. Habia un atajo en
  // TypeScript que devolvia `stale` sin llamar al RPC cuando su lectura -sin
  // cerrojo- ya veia el `move_seq` movido. Con ese atajo puesto, el reclamo del
  // que perdio nunca llega al unico sitio donde se puede reconocer el duelo: la
  // carrera se resuelve bien y la cifra se queda en cero para siempre.
  check(
    "no queda el atajo que devolvia stale antes del RPC",
    /if \(match\.move_seq !== params\.seq/.test(matches),
    false
  );
  check(
    "applyMove sigue llamando a arena_apply_move",
    /db\.rpc\("arena_apply_move"/.test(matches),
    true
  );
}

console.log("\n— Un duelo es una CARRERA, no un retraso —");
{
  // Solo el reclamo que va exactamente una jugada atras. Dos o mas atras es una
  // pantalla vieja, no una carrera.
  check(
    "solo cuenta el reclamo de la jugada inmediatamente anterior",
    /p_seq = v_match\.move_seq - 1/.test(sql),
    true
  );

  // Y solo si llego dentro de la ventana. Sin esto, tocar dos segundos tarde
  // contaria como duelo perdido y le regalaria un duelo ganado al otro.
  check(
    "hay ventana de tiempo",
    /c_duel_window\s+constant\s+interval/.test(sql),
    true
  );
  check(
    "y se compara contra ella",
    /now\(\) - v_match\.base_taken_at <= c_duel_window/.test(sql),
    true
  );
}

console.log("\n— El reloj es el del SERVIDOR —");
{
  // La ventana se mide entre dos instantes que pone Postgres. Si alguna vez
  // entrara un tiempo del cliente en esta cuenta, bastaria con mentir en el
  // cuerpo de la peticion para fabricarse duelos.
  check(
    "la base se sella con now() del servidor",
    /base_taken_at = now\(\)/.test(sql),
    true
  );
  const argumentos = sql.match(/create or replace function public\.arena_apply_move\(([\s\S]*?)\)\s*returns/);
  const params = (argumentos?.[1] ?? "").toLowerCase();
  check(
    "la funcion no recibe ningun tiempo del cliente",
    /time|clock|ms\b|tap|now/.test(params),
    false
  );
  check(
    "la ruta de mover no manda ningun tiempo",
    /p_(at|time|ms|clock|tapped)/.test(matches),
    false
  );
}

console.log("\n— Un duelo por jugada disputada, y nunca contra uno mismo —");
{
  // Con cuatro en la mesa pueden llegar tres reclamos por la misma base. Ganar
  // una carrera es ganar una carrera: se cuenta una vez.
  check(
    "hay marca de 'ya contado' para esta base",
    /base_duel_counted/.test(sql),
    true
  );
  check(
    "no se cuenta dos veces la misma base",
    /and not v_match\.base_duel_counted/.test(sql),
    true
  );
  check(
    "y la marca se levanta al contarlo",
    /set base_duel_counted = true/.test(sql),
    true
  );
  check(
    "base nueva, duelo nuevo: la marca se reinicia al ganar la base",
    /base_duel_counted = false/.test(sql),
    true
  );

  // Un doble toque manda dos peticiones; la segunda llega `stale` contra tu
  // propia jugada. Sin esto te ganarias duelos a ti mismo.
  check(
    "nadie se gana un duelo contra si mismo",
    /v_match\.base_taken_by <> p_profile/.test(sql),
    true
  );
}

console.log("\n— Y lo que NO puede sumar —");
{
  // El `stale` de "tu carta ya no es esa" ocurre con la base QUIETA: no hubo
  // carrera por ella. Se comprueba que esa rama esta despues del bloque del
  // duelo y no incrementa nada.
  const ramaCarta = sql.slice(sql.indexOf("v_player.deck[1] <> p_card"));
  check(
    "el stale por carta propia no suma duelo",
    /duels_won = duels_won \+ 1/.test(ramaCarta.slice(0, 400)),
    false
  );

  // Fallar no es ganar. La rama de castigo no toca el sello de la base ni
  // reparte duelos.
  const ramaCastigo = sql.slice(sql.indexOf("errors = errors + 1"));
  check(
    "la rama de castigo no reparte duelos",
    /duels_won/.test(ramaCastigo),
    false
  );
  check(
    "la rama de castigo no re-sella la base",
    /base_taken_by = /.test(ramaCastigo),
    false
  );

  // Y el incremento aparece UNA sola vez en todo el archivo: en la rama del
  // duelo y en ninguna otra.
  check(
    "duels_won se incrementa en un solo sitio",
    (sql.match(/duels_won = duels_won \+ 1/g) ?? []).length,
    1
  );
}

console.log("\n— La pantalla ya no ensena jugadas normales —");
{
  check(
    "el total ya no suma `correct`",
    /sum \+ p\.correct/.test(vista),
    false
  );
  check(
    "el total suma duelos ganados",
    /sum \+ p\.duelsWon/.test(vista),
    true
  );
  check(
    "la columna de la tabla ensena duelos",
    /\{player\.duelsWon\}/.test(vista),
    true
  );
  check(
    "ya no queda la clave vieja en la pantalla",
    /match\.(over|table)\.taken/.test(vista),
    false
  );
  check(
    "ni en el diccionario",
    /"match\.(over|table)\.taken"/.test(dict),
    false
  );
  check("texto en espanol", /"match\.over\.duels": "Duelos ganados"/.test(dict), true);
  check("texto en ingles", /"match\.over\.duels": "Duels won"/.test(dict), true);
  check("el tipo lo expone", /duelsWon: number/.test(tipos), true);
}

console.log(
  failed === 0
    ? "\nTodo bien. (El comportamiento real necesita base de datos y dos clientes.)\n"
    : `\n${failed} comprobacion(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
