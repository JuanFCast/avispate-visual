"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatMs } from "@/lib/game";
import { USDT_DECIMALS } from "@/lib/contracts";
import type { StatsPayload } from "@/lib/stats";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import StatTile from "./StatTile";
import PlaysTrend from "./PlaysTrend";

const REFRESH_MS = 60_000;

/* ------------------------------- Formateo ---------------------------------- */

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
  const { t, locale } = useI18n();
  const { data, status, refetch, isFetching } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    staleTime: REFRESH_MS,
    gcTime: 5 * 60_000,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });

  /** Miles y decimales según el idioma de la pantalla. */
  const num = (n: number) => n.toLocaleString(locale);

  if (status === "error") {
    return (
      <div className="hist-state">
        <p className="empty-note">{t("stats.error")}</p>
        <button type="button" className="btn-ghost" onClick={() => refetch()}>
          {t("common.retry")}
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
            {t("stats.today")}
          </h2>
          <span className="stats-live" aria-live="polite">
            {isFetching ? t("stats.updating") : t("stats.live")}
          </span>
        </div>

        <div className="stats-tiles">
          <StatTile
            label={t("stats.today.players")}
            value={num(d?.today.players ?? 0)}
            hint={t("stats.today.players_hint")}
            tint="yellow"
            loading={loading}
          />
          <StatTile
            label={t("stats.today.plays")}
            value={num(d?.today.plays ?? 0)}
            hint={
              d
                ? t("stats.today.plays_hint", {
                    paid: num(d.today.paidPlays),
                    free: num(d.today.freePlays),
                  })
                : undefined
            }
            tint="cyan"
            loading={loading}
          />
          <StatTile
            label={t("stats.today.new")}
            value={num(d?.today.newPlayers ?? 0)}
            hint={t("stats.today.new_hint")}
            loading={loading}
          />
          <StatTile
            label={t("stats.today.pot")}
            value={`${usdt(d?.economy.livePotUnits)} USDT`}
            hint={t("stats.today.pot_hint")}
            tint="good"
            loading={loading}
          />
        </div>
      </section>

      {/* ----------------------------- Tendencia ----------------------------- */}
      <section className="profile-section" aria-labelledby="stats-tendencia">
        <h2 className="section-title" id="stats-tendencia">
          {t("stats.trend.title")}
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
              {t("stats.players")}
            </h2>

            <div className="stats-tiles">
              <StatTile
                label={t("stats.players.total")}
                value={num(d?.players.total ?? 0)}
                hint={
                  d
                    ? t("stats.players.total_hint", {
                        email: num(d.players.withEmail),
                        wallet: num(d.players.walletOnly),
                      })
                    : undefined
                }
                loading={loading}
              />
              <StatTile
                label={t("stats.players.active7")}
                value={num(d?.players.active7 ?? 0)}
                loading={loading}
              />
              <StatTile
                label={t("stats.players.active30")}
                value={num(d?.players.active30 ?? 0)}
                loading={loading}
              />
              <StatTile
                label={t("stats.players.paid")}
                value={`${d?.players.paidConversionPct ?? 0}%`}
                hint={
                  d
                    ? t("stats.players.paid_hint", {
                        paid: num(d.players.everPaid),
                        total: num(
                          d.players.distribution.reduce(
                            (s, b) => s + b.players,
                            0
                          )
                        ),
                      })
                    : undefined
                }
                tint="yellow"
                loading={loading}
              />
            </div>

            <h3 className="stats-subtitle">{t("stats.players.distribution")}</h3>
            <ul className="stats-bars">
              {(d?.players.distribution ?? []).map((b) => (
                <li className="stats-bar-row" key={b.bucket}>
                  <span className="stats-bar-label">
                    {t(`stats.bucket.${b.bucket}` as MessageKey)}
                  </span>
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
              {t("stats.retention")}
            </h2>
            <p className="section-note">{t("stats.retention.note")}</p>
            <table className="stats-table">
              <thead>
                <tr>
                  <th scope="col">{t("stats.retention.window")}</th>
                  <th scope="col">{t("stats.retention.returned")}</th>
                  <th scope="col">%</th>
                </tr>
              </thead>
              <tbody>
                {(d?.retention ?? []).map((r) => (
                  <tr key={r.window}>
                    <th scope="row">
                      {t(`stats.retention.${r.window}` as MessageKey)}
                    </th>
                    <td>
                      {num(r.returned)}{" "}
                      <small>
                        {t("stats.retention.of", { total: num(r.eligible) })}
                      </small>
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
              {t("stats.plays")}
            </h2>
            <div className="stats-tiles">
              <StatTile
                label={t("stats.plays.total")}
                value={num(d?.plays.total ?? 0)}
                hint={
                  d
                    ? t("stats.plays.total_hint", {
                        paid: num(d.plays.paid),
                        free: num(d.plays.free),
                      })
                    : undefined
                }
                tint="cyan"
                loading={loading}
              />
              <StatTile
                label={t("stats.plays.best")}
                value={ms(d?.plays.bestAverageMs ?? null)}
                hint={t("stats.plays.best_hint")}
                tint="yellow"
                loading={loading}
              />
              <StatTile
                label={t("stats.plays.average")}
                value={ms(d?.plays.averageMs ?? null)}
                hint={t("stats.plays.average_hint")}
                loading={loading}
              />
              <StatTile
                label={t("stats.plays.accuracy")}
                value={`${d?.plays.accuracyPct ?? 0}%`}
                loading={loading}
              />
            </div>
          </section>

          {/* ------------------------------ Mazos ----------------------------- */}
          <section className="profile-section" aria-labelledby="stats-mazos">
            <h2 className="section-title" id="stats-mazos">
              {t("stats.decks")}
            </h2>
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th scope="col">{t("stats.decks.deck")}</th>
                    <th scope="col">{t("stats.decks.plays")}</th>
                    <th scope="col">{t("stats.decks.players")}</th>
                    <th scope="col">{t("stats.decks.best")}</th>
                    <th scope="col">{t("stats.decks.pot")}</th>
                    <th scope="col">{t("stats.decks.paid")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(d?.decks ?? []).map((deck) => (
                    <tr key={deck.deck}>
                      <th scope="row">
                        {t("stats.decks.cards", { n: deck.deck })}
                      </th>
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
            <p className="section-note">{t("stats.decks.note")}</p>
          </section>
        </div>
      </div>

      {/* ------------------------------ Economía ------------------------------ */}
      <section className="profile-section" aria-labelledby="stats-economia">
        <h2 className="section-title" id="stats-economia">
          {t("stats.economy")}
        </h2>
        <div className="stats-tiles">
          <StatTile
            label={t("stats.economy.paid_out")}
            value={`${usdt(d?.economy.paidOutUnits)} USDT`}
            hint={
              d
                ? t("stats.economy.paid_out_hint", {
                    rounds: num(d.economy.roundsWithWinner),
                  })
                : undefined
            }
            tint="good"
            loading={loading}
          />
          <StatTile
            label={t("stats.economy.biggest")}
            value={`${usdt(d?.economy.biggestPrizeUnits)} USDT`}
            loading={loading}
          />
          <StatTile
            label={t("stats.economy.revenue")}
            value={`${usdt(d?.economy.revenueUnits)} USDT`}
            hint={
              d?.economy.feeUnits
                ? t("stats.economy.revenue_hint", {
                    paid: num(d.plays.paid),
                    fee: usdt(d.economy.feeUnits),
                  })
                : undefined
            }
            tint="yellow"
            loading={loading}
          />
          <StatTile
            label={t("stats.economy.commission")}
            value={`${usdt(d?.economy.commissionUnits)} USDT`}
            hint={
              d?.economy.commissionBps !== null &&
              d?.economy.commissionBps !== undefined
                ? t("stats.economy.commission_hint", {
                    pct: d.economy.commissionBps / 100,
                  })
                : undefined
            }
            loading={loading}
          />
          <StatTile
            label={t("stats.economy.settled")}
            value={num(d?.economy.roundsSettled ?? 0)}
            hint={
              d
                ? t("stats.economy.settled_hint", {
                    n: num(d.economy.rollovers),
                  })
                : undefined
            }
            loading={loading}
          />
          <StatTile
            label={t("stats.economy.pending")}
            value={`${usdt(d?.economy.pendingUnits)} USDT`}
            hint={t("stats.economy.pending_hint")}
            loading={loading}
          />
        </div>
        <p className="section-note">
          {t("stats.economy.note1", { fee: usdt(d?.economy.feeUnits) })}
        </p>
        <p className="section-note">{t("stats.economy.note2")}</p>
      </section>

      {/* -------------------------------- Cadena ------------------------------ */}
      <section className="profile-section" aria-labelledby="stats-cadena">
        <h2 className="section-title" id="stats-cadena">
          {t("stats.chain")}
        </h2>
        <div className="stats-tiles">
          <StatTile
            label={t("stats.chain.plays")}
            value={num(d?.chain.playTxs ?? 0)}
            hint={t("stats.chain.plays_hint")}
            loading={loading}
          />
          <StatTile
            label={t("stats.chain.prizes")}
            value={num(d?.chain.prizeTxs ?? 0)}
            loading={loading}
          />
          <StatTile
            label={t("stats.chain.wallets")}
            value={num(d?.chain.wallets ?? 0)}
            loading={loading}
          />
          <StatTile
            label={t("stats.chain.gas")}
            value={d ? `${celoFromWei(d.chain.welcomeGasWei)} CELO` : "—"}
            hint={
              d
                ? t("stats.chain.gas_hint", {
                    n: num(d.chain.welcomeGasCount),
                  })
                : undefined
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
            {t("stats.chain.contract")}
          </a>
        )}
      </section>

      {/* --------------------------------- Nota ------------------------------- */}
      <section className="profile-section stats-note" aria-labelledby="stats-nota">
        <h2 className="section-title" id="stats-nota">
          {t("stats.how")}
        </h2>
        <p className="section-note">
          {t("stats.how.1a")} <strong>{t("stats.how.1strong")}</strong>
          {t("stats.how.1b")}{" "}
          <Link href="/historial">{t("stats.how.1link")}</Link>.
        </p>
        <p className="section-note">
          {t("stats.how.2a")} <strong>{t("stats.how.2strong")}</strong>{" "}
          {t("stats.how.2b")}
        </p>
        {d?.truncated && (
          <p className="section-note">{t("stats.truncated")}</p>
        )}
        {d && (
          <p className="stats-updated">
            {t("stats.updated", {
              when: new Date(d.generatedAt).toLocaleString(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        )}
      </section>
    </>
  );
}
