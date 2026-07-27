// Verifica la aritmética del panel público de estadísticas (/stats): que los
// agregados salgan de las filas y no de suposiciones, que la retención no
// cuente a quien todavía no tuvo tiempo de volver, y que los montos USDT se
// sumen como enteros (nunca como float).
//
// Correr: node scripts/verify-stats.ts
//
// Sin dependencias: Node 22+ ejecuta TypeScript quitando los tipos.
import {
  buildDecks,
  buildEconomy,
  buildPlayers,
  buildPlays,
  buildRetention,
  buildToday,
  roundsBetween,
  shiftRound,
  type ChainSnapshot,
  type StatsProfileRow,
  type StatsScoreRow,
  type StatsSettlementRow,
} from "../lib/stats.ts";

let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FALLA"} ${name}` +
      (ok ? "" : `\n         esperado ${JSON.stringify(expected)}\n         recibido ${JSON.stringify(actual)}`)
  );
}

const TODAY = "2026-07-26";

/** Fila de partida con lo mínimo; el resto son valores neutros. */
function score(
  profile: string,
  round: string,
  extra: Partial<StatsScoreRow> = {}
): StatsScoreRow {
  return {
    profile_id: profile,
    round_date: round,
    deck_size: 10,
    is_paid: false,
    average_ms: 1000,
    accuracy: 100,
    errors: 0,
    tx_hash: null,
    ...extra,
  };
}

function profile(
  id: string,
  created: string,
  extra: Partial<StatsProfileRow> = {}
): StatsProfileRow {
  return {
    id,
    created_at: created,
    privy_id: null,
    wallet_address: `0x${id}`,
    ...extra,
  };
}

const CHAIN: ChainSnapshot = {
  potsByDeck: { 10: "1500000", 15: "2000000", 20: "500000" },
  feeUnits: "100000", // 0.10 USDT
  commissionBps: 2000, // 20%
};

// ---------- Calendario de rondas ----------
console.log("\nRondas (el día del panel es la ronda, 00:00 UTC)");
check("un día antes del 26 es el 25", shiftRound(TODAY, -1), "2026-07-25");
check("30 rondas atrás desde el 26", shiftRound(TODAY, -30), "2026-06-26");
check("distancia entre el 20 y el 26", roundsBetween("2026-07-20", TODAY), 6);
check("la distancia de un día consigo mismo es 0", roundsBetween(TODAY, TODAY), 0);

// ---------- Hoy ----------
console.log("\nLa ronda de hoy");
{
  const scores = [
    score("a", TODAY),
    score("a", TODAY, { is_paid: true }),
    score("b", TODAY),
    score("c", "2026-07-25"), // ronda anterior: no cuenta hoy
  ];
  const profiles = [
    profile("a", "2026-07-26T02:00:00Z"), // dentro de la ronda de hoy
    profile("b", "2026-07-25T22:00:00Z"), // antes de las 00:00 UTC de hoy
    profile("c", "2026-07-26T10:00:00Z"),
  ];
  const today = buildToday(scores, profiles, TODAY);
  check("jugadores distintos de hoy", today.players, 2);
  check("partidas de hoy", today.plays, 3);
  check("pagas de hoy", today.paidPlays, 1);
  check("gratis de hoy", today.freePlays, 2);
  check("nuevos de hoy los cuenta por created_at", today.newPlayers, 2);
}

// ---------- Jugadores ----------
console.log("\nJugadores");
{
  const scores = [
    score("a", TODAY, { is_paid: true }),
    score("a", "2026-07-20"),
    score("b", "2026-07-24"),
    // Bordes de la ventana de 30 días (hoy incluido: del -29 al 0).
    score("c", shiftRound(TODAY, -29)), // último día que SÍ cuenta
    score("d", shiftRound(TODAY, -30)), // un día más viejo: ya no cuenta
  ];
  const profiles = [
    profile("a", "2026-07-01T00:00:00Z", { privy_id: "did:privy:a" }),
    profile("b", "2026-07-02T00:00:00Z"),
    profile("c", "2026-07-03T00:00:00Z"),
    profile("d", "2026-07-04T00:00:00Z"),
    profile("e", "2026-07-05T00:00:00Z"), // registrado, nunca jugó
  ];
  const players = buildPlayers(scores, profiles, TODAY);
  check("total cuenta perfiles, hayan jugado o no", players.total, 5);
  check("con correo", players.withEmail, 1);
  check("solo wallet", players.walletOnly, 4);
  check("activos 7 días (hoy incluido)", players.active7, 2);
  check("activos 30 días: entra el del día -29, no el del -30", players.active30, 3);
  check("han pagado alguna vez", players.everPaid, 1);
  check(
    "la conversión se mide sobre quien jugó (4), no sobre los registrados (5)",
    players.paidConversionPct,
    25
  );
  check(
    "distribución por partidas jugadas",
    players.distribution.map((b) => b.players),
    [3, 1, 0, 0]
  );
}

// ---------- Retención ----------
console.log("\nRetención");
{
  const scores = [
    // Estrenó hace 10 días y volvió al día siguiente: cuenta en las 3 ventanas
    // que ya se pueden medir (1 y 7), pero NO en la de 30.
    score("vuelve", shiftRound(TODAY, -10)),
    score("vuelve", shiftRound(TODAY, -9)),
    // Estrenó hace 10 días y no volvió nunca.
    score("nunca", shiftRound(TODAY, -10)),
    // Estrenó HOY: no tuvo tiempo de volver, no puede entrar al denominador.
    score("nuevo", TODAY),
  ];
  const r = buildRetention(scores, TODAY);
  check(
    "al día siguiente: 1 de 2 (el que estrenó hoy no cuenta)",
    [r[0].returned, r[0].eligible, r[0].pct],
    [1, 2, 50]
  );
  check(
    "en 7 días: el que volvió al día 1 también cuenta",
    [r[1].returned, r[1].eligible, r[1].pct],
    [1, 2, 50]
  );
  check(
    "en 30 días: nadie tiene 30 días de historia todavía",
    [r[2].returned, r[2].eligible],
    [0, 0]
  );
}

// ---------- Partidas y tendencia ----------
console.log("\nPartidas");
{
  const scores = [
    score("a", TODAY, { average_ms: 800, accuracy: 90 }),
    score("b", TODAY, { average_ms: 1200, accuracy: 100, is_paid: true }),
    score("c", shiftRound(TODAY, -40), { average_ms: 400, accuracy: 80 }),
  ];
  const plays = buildPlays(scores, TODAY);
  check("total", plays.total, 3);
  check("pagas", plays.paid, 1);
  check("promedio por carta", plays.averageMs, 800);
  check("mejor marca es el mínimo", plays.bestAverageMs, 400);
  check("precisión media", plays.accuracyPct, 90);
  check("la tendencia trae 30 puntos", plays.trend.length, 30);
  check("el último punto es hoy", plays.trend[29].roundId, TODAY);
  check("hoy tiene 2 partidas", plays.trend[29].plays, 2);
  check(
    "la partida de hace 40 días queda fuera de la ventana",
    plays.trend.reduce((s, p) => s + p.plays, 0),
    2
  );
}

// ---------- Mazos ----------
console.log("\nPor mazo");
{
  const scores = [
    score("a", TODAY, { deck_size: 10, average_ms: 900 }),
    score("b", TODAY, { deck_size: 10, average_ms: 700 }),
    score("a", TODAY, { deck_size: 20, average_ms: 1500 }),
  ];
  const settlements: StatsSettlementRow[] = [
    {
      round_date: "2026-07-25",
      deck_size: 10,
      amount_units: "1200000",
      tx_hash: "0xpaid",
      winner_wallet: "0xa",
    },
    {
      round_date: "2026-07-24",
      deck_size: 10,
      amount_units: "800000",
      tx_hash: null, // aún sin pagar: no suma a "pagado"
      winner_wallet: "0xb",
    },
  ];
  const decks = buildDecks(scores, settlements, CHAIN, [10, 15, 20]);
  check("mazo 10: partidas", decks[0].plays, 2);
  check("mazo 10: jugadores distintos", decks[0].players, 2);
  check("mazo 10: mejor marca", decks[0].bestAverageMs, 700);
  check("mazo 10: pozo on-chain", decks[0].potUnits, "1500000");
  check("mazo 10: solo cuenta lo ya pagado", decks[0].paidOutUnits, "1200000");
  check("mazo 15: sin partidas", [decks[1].plays, decks[1].bestAverageMs], [0, null]);
  check("mazo 20: rondas ganadas", decks[2].roundsWon, 0);
}

// ---------- Economía ----------
console.log("\nEconomía");
{
  const scores = [
    score("a", TODAY, { is_paid: true }),
    score("b", TODAY, { is_paid: true }),
    score("c", TODAY), // gratis: no recauda
  ];
  const settlements: StatsSettlementRow[] = [
    {
      round_date: "2026-07-25",
      deck_size: 10,
      amount_units: "1200000",
      tx_hash: "0xpaid",
      winner_wallet: "0xa",
    },
    {
      round_date: "2026-07-25",
      deck_size: 15,
      amount_units: "900000",
      tx_hash: null,
      winner_wallet: "0xb", // ganador definido, pago pendiente
    },
    {
      round_date: "2026-07-25",
      deck_size: 20,
      amount_units: null,
      tx_hash: null,
      winner_wallet: null, // nadie jugó: el pozo rueda
    },
  ];
  const eco = buildEconomy(scores, settlements, CHAIN);
  check("recaudado = 2 pagas × 0.10", eco.revenueUnits, "200000");
  check("comisión del 20%", eco.commissionUnits, "40000");
  check("al pozo el resto", eco.toPotUnits, "160000");
  check("pagado solo lo que tiene tx", eco.paidOutUnits, "1200000");
  check("pendiente aparte", eco.pendingUnits, "900000");
  check("premio más grande", eco.biggestPrizeUnits, "1200000");
  check("pozo vivo = suma de los tres mazos", eco.livePotUnits, "4000000");
  check("rondas liquidadas", eco.roundsSettled, 3);
  check("rondas con ganador", eco.roundsWithWinner, 2);
  check("rondas sin ganador", eco.rollovers, 1);
}

// ---------- Cadena caída ----------
console.log("\nSi la cadena no responde, el panel no se cae");
{
  const offline: ChainSnapshot = {
    potsByDeck: { 10: null, 15: null, 20: null },
    feeUnits: null,
    commissionBps: null,
  };
  const eco = buildEconomy([score("a", TODAY, { is_paid: true })], [], offline);
  check("sin tarifa no se inventa recaudo", eco.revenueUnits, null);
  check("sin pozos no se inventa el pozo vivo", eco.livePotUnits, null);
  check("lo de la base sigue saliendo", eco.paidOutUnits, "0");
}

// ---------- Sin datos ----------
console.log("\nJuego recién estrenado (todo en cero, sin NaN)");
{
  const plays = buildPlays([], TODAY);
  check("promedio con 0 partidas es 0, no NaN", plays.averageMs, 0);
  check("mejor marca sin partidas es null", plays.bestAverageMs, null);
  const players = buildPlayers([], [], TODAY);
  check("conversión sin jugadores es 0, no NaN", players.paidConversionPct, 0);
  const eco = buildEconomy([], [], CHAIN);
  check("sin premios no hay 'más grande'", eco.biggestPrizeUnits, null);
}

console.log(
  failed === 0
    ? "\nTodo bien: las estadísticas cuadran.\n"
    : `\n${failed} comprobación(es) fallaron.\n`
);
process.exit(failed === 0 ? 0 : 1);
