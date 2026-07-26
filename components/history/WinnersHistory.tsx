"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { USDT_DECIMALS } from "@/lib/contracts";
import { formatMs } from "@/lib/game";

const PAGE_SIZE = 15;

export interface HistoryRound {
  roundDate: string;
  deck: number;
  prizeUnits: string | null;
  winnerAlias: string | null;
  /** Ya viene abreviada del servidor. */
  winnerWallet: string | null;
  averageMs: number | null;
  errors: number | null;
  txHash: string | null;
  payout: "paid" | "pending" | "rollover";
}

interface Page {
  history: HistoryRound[];
  hasMore: boolean;
}

const MONTHS = [
  "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
  "JUL", "AGO", "SEP", "OCT", "NOV", "DIC",
];

/**
 * "25 JUL 2026" a partir del texto YYYY-MM-DD, sin pasar por `Date`: la fecha
 * de la ronda es la de Colombia y no debe correrse a la zona del visitante.
 */
function fmtRoundDate(roundDate: string): string {
  const [year, month, day] = roundDate.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""} ${year}`;
}

function fmtPrize(units: string | null): string {
  if (units === null) return "—";
  return `${(Number(units) / 10 ** USDT_DECIMALS).toFixed(2)} USDT`;
}

const PAYOUT_LABEL: Record<HistoryRound["payout"], string> = {
  paid: "Premio pagado",
  pending: "Pago procesándose",
  rollover: "Premio acumulado",
};

async function fetchPage(offset: number): Promise<Page> {
  const res = await fetch(`/api/history?limit=${PAGE_SIZE}&offset=${offset}`);
  if (!res.ok) throw new Error("history_fetch_failed");
  return (await res.json()) as Page;
}

/**
 * Historial público de ganadores: una tarjeta por ronda cerrada y mazo, con
 * premio, ganador, marca y estado del pago. Los datos salen de la liquidación
 * persistida (`round_settlements`), nunca del ranking en vivo ni del
 * dispositivo, así que recargar o cambiar de aparato no cambia nada.
 */
export default function WinnersHistory() {
  const {
    data,
    status,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["history"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage(pageParam as number),
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length * PAGE_SIZE : undefined,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  if (status === "pending") {
    return (
      <ul className="hist-list" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="hist-item hist-item-skeleton">
            <span className="skeleton hist-skeleton" />
          </li>
        ))}
      </ul>
    );
  }

  if (status === "error") {
    return (
      <div className="hist-state">
        <p className="empty-note">No pudimos cargar los ganadores.</p>
        <button type="button" className="btn-ghost" onClick={() => refetch()}>
          Reintentar
        </button>
      </div>
    );
  }

  const rounds = data?.pages.flatMap((p) => p.history) ?? [];

  if (rounds.length === 0) {
    return (
      <div className="hist-state">
        <p className="empty-note">
          Aún no hay ganadores. El primero aparecerá al cerrar una ronda.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="hist-list">
        {rounds.map((round) => {
          const name = round.winnerAlias || round.winnerWallet;
          return (
            <li
              key={`${round.roundDate}-${round.deck}`}
              className={`hist-item${name ? "" : " hist-item-empty"}`}
            >
              <div className="hist-head">
                <span className="hist-date">
                  {fmtRoundDate(round.roundDate)}
                </span>
                <span className="hist-deck">Mazo {round.deck}</span>
                <span className={`hist-badge hist-badge-${round.payout}`}>
                  {PAYOUT_LABEL[round.payout]}
                </span>
              </div>

              <div className="hist-body">
                <span className="hist-prize">{fmtPrize(round.prizeUnits)}</span>
                <span className="hist-winner">
                  <small className="hist-winner-label">
                    {name ? "GANADOR" : "SIN GANADOR"}
                  </small>
                  <strong className="hist-winner-name">
                    {name ?? "Nadie jugó esta ronda"}
                  </strong>
                  {round.averageMs !== null && (
                    <small className="hist-result">
                      Tiempo: {formatMs(round.averageMs)} por carta
                      {round.errors !== null && ` · ${round.errors} err`}
                    </small>
                  )}
                </span>
              </div>

              {round.txHash && (
                <a
                  className="hist-tx"
                  href={`https://celoscan.io/tx/${round.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ver el pago en Celoscan ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>

      {hasNextPage && (
        <button
          type="button"
          className="btn-ghost hist-more"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? "Cargando…" : "Ver más"}
        </button>
      )}
    </>
  );
}
