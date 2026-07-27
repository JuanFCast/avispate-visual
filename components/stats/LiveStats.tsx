"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatMs } from "@/lib/game";
import { USDT_DECIMALS } from "@/lib/contracts";
import type { StatsPayload } from "@/lib/stats";
import StatTile from "./StatTile";
import PlaysTrend from "./PlaysTrend";

const REFRESH_MS = 60_000;

/* ------------------------------- Formateo ---------------------------------- */

const num = (n: number) => n.toLocaleString("es-CO");

/** Unidades del token → "1.23". Un guion cuando la cadena no respondió. */
function usdt(units: string | null | undefined): string {
  if (units === null || units === undefined) return "—";
  return (Number(units) / 10 ** USDT_DECIMALS).toFixed(2);
}

function celoFromWei(wei: string): string {
  return (Number(wei) / 1e18).toFixed(3);
}

function ms(value: number | null): string {
  return value === null ? "—" : formatMs(value);
}

async function fetchStats(): Promise<StatsPayload> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error("stats_fetch_failed");
  return (await res.json()) as StatsPayload;
}

/**
 * Panel público de estadísticas en vivo.
 *
 * Solo agregados: ni una wallet completa, ni un correo, ni un alias pegado a
 * una dirección. Se refresca solo cada minuto, que es lo que dura la caché del
 * endpoint — pedir más seguido no traería datos más nuevos.
 */
export default function LiveStats() {
  const { data, status, refetch, isFetching } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    staleTime: REFRESH_MS,
    gcTime: 5 * 60_000,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });

  if (status === "error") {
    return (
      <div className="hist-state">
        <p className="empty-note">No pudimos cargar las estadísticas.</p>
        <button type="button" className="btn-ghost" onClick={() => refetch()}>
          Reintentar
        </button>
      </div>
    );
  }

  const loading = status === "pending";
  const d = data;

  return (
    <>
      {/* -------------------------------- Hoy -------------------------------- */}
      <section className="profile-section" aria-labelledby="stats-hoy">
        <div className="stats-head">
          <h2 className="section-title" id="stats-hoy">
            La ronda de hoy
          </h2>
          <span className="stats-live" aria-live="polite">
            {isFetching ? "Actualizando…" : "En vivo"}
          </span>
        </div>

        <div className="stats-tiles">
          <StatTile
            label="Jugadores"
            value={num(d?.today.players ?? 0)}
            hint="distintos, en esta ronda"
            tint="yellow"
            loading={loading}
          />
          <StatTile
            label="Partidas"
            value={num(d?.today.plays ?? 0)}
            hint={
              d
                ? `${num(d.today.paidPlays)} pagas · ${num(d.today.freePlays)} gratis`
                : undefined
            }
            tint="cyan"
            loading={loading}
          />
          <StatTile
            label="Jugadores nuevos"
            value={num(d?.today.newPlayers ?? 0)}
            hint="se registraron hoy"
            loading={loading}
          />
          <StatTile
            label="Pozo en juego"
            value={`${usdt(d?.economy.livePotUnits)} USDT`}
            hint="suma de los tres mazos, en el contrato"
            tint="good"
            loading={loading}
          />
        </div>
      </section>

      {/* ----------------------------- Tendencia ----------------------------- */}
      <section className="profile-section" aria-labelledby="stats-tendencia">
        <h2 className="section-title" id="stats-tendencia">
          Partidas por día · últimos 30 días
        </h2>
        {loading ? (
          <span className="skeleton stats-trend-skeleton" />
        ) : (
          <PlaysTrend points={d!.plays.trend} />
        )}
      </section>

      <div className="page-grid">
        <div className="page-col">
          {/* ---------------------------- Jugadores --------------------------- */}
          <section className="profile-section" aria-labelledby="stats-jugadores">
            <h2 className="section-title" id="stats-jugadores">
              Jugadores
            </h2>

            <div className="stats-tiles">
              <StatTile
                label="Total"
                value={num(d?.players.total ?? 0)}
                hint={
                  d
                    ? `${num(d.players.withEmail)} con correo · ${num(d.players.walletOnly)} solo wallet`
                    : undefined
                }
                loading={loading}
              />
              <StatTile
                label="Activos (7 días)"
                value={num(d?.players.active7 ?? 0)}
                loading={loading}
              />
              <StatTile
                label="Activos (30 días)"
                value={num(d?.players.active30 ?? 0)}
                loading={loading}
              />
              <StatTile
                label="Han pagado alguna"
                value={`${d?.players.paidConversionPct ?? 0}%`}
                hint={
                  d
                    ? `${num(d.players.everPaid)} de ${num(
                        d.players.distribution.reduce((s, b) => s + b.players, 0)
                      )} que jugaron`
                    : undefined
                }
                tint="yellow"
                loading={loading}
              />
            </div>

            <h3 className="stats-subtitle">Cuántas partidas juega cada uno</h3>
            <ul className="stats-bars">
              {(d?.players.distribution ?? []).map((b) => (
                <li className="stats-bar-row" key={b.label}>
                  <span className="stats-bar-label">{b.label}</span>
                  <span className="stats-bar-track">
                    <span
                      className="stats-bar-fill"
                      style={{ width: `${b.pct}%` }}
                    />
                  </span>
                  <span className="stats-bar-value">
                    {num(b.players)} <small>{b.pct}%</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* ---------------------------- Retención --------------------------- */}
          <section className="profile-section" aria-labelledby="stats-retencion">
            <h2 className="section-title" id="stats-retencion">
              Retención
            </h2>
            <p className="section-note">
              De quienes ya tuvieron tiempo de volver, cuántos volvieron a jugar
              dentro de esa ventana.
            </p>
            <table className="stats-table">
              <thead>
                <tr>
                  <th scope="col">Ventana</th>
                  <th scope="col">Volvieron</th>
                  <th scope="col">%</th>
                </tr>
              </thead>
              <tbody>
                {(d?.retention ?? []).map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>
                      {num(r.returned)} <small>de {num(r.eligible)}</small>
                    </td>
                    <td className="stats-td-strong">{r.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="page-col">
          {/* ----------------------------- Partidas --------------------------- */}
          <section className="profile-section" aria-labelledby="stats-partidas">
            <h2 className="section-title" id="stats-partidas">
              Partidas
            </h2>
            <div className="stats-tiles">
              <StatTile
                label="Total jugadas"
                value={num(d?.plays.total ?? 0)}
                hint={
                  d
                    ? `${num(d.plays.paid)} pagas · ${num(d.plays.free)} gratis`
                    : undefined
                }
                tint="cyan"
                loading={loading}
              />
              <StatTile
                label="Mejor marca"
                value={ms(d?.plays.bestAverageMs ?? null)}
                hint="por carta, récord absoluto"
                tint="yellow"
                loading={loading}
              />
              <StatTile
                label="Promedio por carta"
                value={ms(d?.plays.averageMs ?? null)}
                hint="media de todas las partidas"
                loading={loading}
              />
              <StatTile
                label="Precisión media"
                value={`${d?.plays.accuracyPct ?? 0}%`}
                loading={loading}
              />
            </div>
          </section>

          {/* ------------------------------ Mazos ----------------------------- */}
          <section className="profile-section" aria-labelledby="stats-mazos">
            <h2 className="section-title" id="stats-mazos">
              Por mazo
            </h2>
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th scope="col">Mazo</th>
                    <th scope="col">Partidas</th>
                    <th scope="col">Jugadores</th>
                    <th scope="col">Mejor marca</th>
                    <th scope="col">Pozo</th>
                    <th scope="col">Pagado</th>
                  </tr>
                </thead>
                <tbody>
                  {(d?.decks ?? []).map((deck) => (
                    <tr key={deck.deck}>
                      <th scope="row">{deck.deck} cartas</th>
                      <td>{num(deck.plays)}</td>
                      <td>{num(deck.players)}</td>
                      <td>{ms(deck.bestAverageMs)}</td>
                      <td>{usdt(deck.potUnits)}</td>
                      <td>{usdt(deck.paidOutUnits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="section-note">
              Pozo y pagado en USDT. “Pagado” es lo que ya salió del contrato
              hacia los ganadores de ese mazo.
            </p>
          </section>
        </div>
      </div>

      {/* ------------------------------ Economía ------------------------------ */}
      <section className="profile-section" aria-labelledby="stats-economia">
        <h2 className="section-title" id="stats-economia">
          Economía
        </h2>
        <div className="stats-tiles">
          <StatTile
            label="Premios pagados"
            value={`${usdt(d?.economy.paidOutUnits)} USDT`}
            hint={
              d ? `en ${num(d.economy.roundsWithWinner)} rondas con ganador` : undefined
            }
            tint="good"
            loading={loading}
          />
          <StatTile
            label="Premio más grande"
            value={`${usdt(d?.economy.biggestPrizeUnits)} USDT`}
            loading={loading}
          />
          <StatTile
            label="Recaudado"
            value={`${usdt(d?.economy.revenueUnits)} USDT`}
            hint={
              d?.economy.feeUnits
                ? `${num(d.plays.paid)} pagas × ${usdt(d.economy.feeUnits)}`
                : undefined
            }
            tint="yellow"
            loading={loading}
          />
          <StatTile
            label="Comisión"
            value={`${usdt(d?.economy.commissionUnits)} USDT`}
            hint={
              d?.economy.commissionBps !== null &&
              d?.economy.commissionBps !== undefined
                ? `${d.economy.commissionBps / 100}% de cada jugada paga`
                : undefined
            }
            loading={loading}
          />
          <StatTile
            label="Rondas liquidadas"
            value={num(d?.economy.roundsSettled ?? 0)}
            hint={
              d ? `${num(d.economy.rollovers)} sin ganador (pozo acumulado)` : undefined
            }
            loading={loading}
          />
          <StatTile
            label="Pago pendiente"
            value={`${usdt(d?.economy.pendingUnits)} USDT`}
            hint="ganador definido, transacción aún sin confirmar"
            loading={loading}
          />
        </div>
        <p className="section-note">
          “Recaudado” se estima con la tarifa que el contrato cobra hoy
          ({usdt(d?.economy.feeUnits)} USDT por jugada paga). Si la tarifa
          cambiara, las jugadas viejas se recalcularían con la nueva.
        </p>
        <p className="section-note">
          Los premios pagados pueden superar lo recaudado: los pozos se
          arrancaron con dinero puesto por Avíspate, no solo con las entradas de
          los jugadores.
        </p>
      </section>

      {/* -------------------------------- Cadena ------------------------------ */}
      <section className="profile-section" aria-labelledby="stats-cadena">
        <h2 className="section-title" id="stats-cadena">
          En la cadena (Celo)
        </h2>
        <div className="stats-tiles">
          <StatTile
            label="Jugadas on-chain"
            value={num(d?.chain.playTxs ?? 0)}
            hint="cada partida firma su transacción"
            loading={loading}
          />
          <StatTile
            label="Pagos de premio"
            value={num(d?.chain.prizeTxs ?? 0)}
            loading={loading}
          />
          <StatTile
            label="Wallets"
            value={num(d?.chain.wallets ?? 0)}
            loading={loading}
          />
          <StatTile
            label="Gas regalado"
            value={
              d ? `${celoFromWei(d.chain.welcomeGasWei)} CELO` : "—"
            }
            hint={
              d ? `a ${num(d.chain.welcomeGasCount)} wallets nuevas` : undefined
            }
            loading={loading}
          />
        </div>
        {d?.chain.potAddress && (
          <a
            className="stats-contract-link"
            href={`https://celoscan.io/address/${d.chain.potAddress}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver el contrato en Celoscan ↗
          </a>
        )}
      </section>

      {/* --------------------------------- Nota ------------------------------- */}
      <section className="profile-section stats-note" aria-labelledby="stats-nota">
        <h2 className="section-title" id="stats-nota">
          Cómo leer esto
        </h2>
        <p className="section-note">
          El día de este panel es la <strong>ronda</strong>: de 7:00 p. m. a
          7:00 p. m. hora de Colombia, igual que los premios. Los montos salen
          del contrato y de las rondas ya liquidadas, así que cuadran con el{" "}
          <Link href="/historial">historial de ganadores</Link>.
        </p>
        <p className="section-note">
          Todavía <strong>no</strong> se miden visitas, país, dispositivo ni
          transacciones fallidas: el juego no tiene analítica instalada, y
          preferimos dejar el hueco a inventar el número.
        </p>
        {d?.truncated && (
          <p className="section-note">
            Hay tantas partidas que el panel está leyendo solo la ventana más
            reciente.
          </p>
        )}
        {d && (
          <p className="stats-updated">
            Datos al{" "}
            {new Date(d.generatedAt).toLocaleString("es-CO", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            . Se actualiza solo cada minuto.
          </p>
        )}
      </section>
    </>
  );
}
