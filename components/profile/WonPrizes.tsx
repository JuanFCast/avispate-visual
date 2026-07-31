"use client";

import Link from "next/link";
import { USDT_DECIMALS } from "@/lib/contracts";
import { useI18n } from "@/lib/i18n/client";
import { fmtRoundDate } from "@/lib/i18n/date";

export interface Prize {
  roundDate: string;
  deck: number;
  amountUnits: string;
  txHash: string | null;
}

interface Props {
  prizes: Prize[];
  loading: boolean;
}

/** Resumen, no historial: solo los premios más recientes caben en el perfil. */
const RECENT = 3;

function fmtUsdt(units: string): string {
  return (Number(units) / 10 ** USDT_DECIMALS).toFixed(2);
}

/**
 * Los últimos premios cobrados (reales, de `round_settlements` ya pagados) más
 * la nota de que el pago es automático: Avíspate no usa "reclamar".
 *
 * Es un resumen a propósito. El total ganado ya está arriba en las tarjetas de
 * estadísticas, así que repetir aquí la lista entera solo alarga el perfil: el
 * registro completo vive en la pestaña Historial, a un toque de la última fila.
 */
export default function WonPrizes({ prizes, loading }: Props) {
  const { t, lang } = useI18n();
  const recent = prizes.slice(0, RECENT);

  return (
    <section className="profile-section prizes-card">
      <h2 className="section-title">{t("prizes.title")}</h2>
      <p className="prizes-note">{t("prizes.note")}</p>

      {loading ? (
        <div className="prize-list" aria-hidden="true">
          <span className="skeleton prize-skeleton" />
          <span className="skeleton prize-skeleton" />
          <span className="skeleton prize-skeleton" />
        </div>
      ) : recent.length === 0 ? (
        <p className="empty-note">{t("prizes.empty")}</p>
      ) : (
        <ul className="prize-list">
          {recent.map((p, i) => (
            <li key={`${p.roundDate}-${p.deck}-${i}`} className="prize-row">
              <span className="prize-trophy" aria-hidden="true">
                🏆
              </span>
              <span className="prize-info">
                <span className="prize-amount">
                  {fmtUsdt(p.amountUnits)} USDT
                </span>
                <small className="prize-meta">
                  {t("prizes.deck", { deck: p.deck })} ·{" "}
                  {fmtRoundDate(p.roundDate, lang)}
                </small>
              </span>
              <span className="prize-end">
                <span className="prize-badge">{t("prizes.paid")}</span>
                {p.txHash && (
                  <a
                    className="prize-tx"
                    href={`https://celoscan.io/tx/${p.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t("prizes.view_aria")}
                    aria-label={t("prizes.view_aria")}
                  >
                    <span aria-hidden="true">↗</span>
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Link className="prize-more-row" href="/historial">
        <span>{t("prizes.more")}</span>
        <span className="prize-more-arrow" aria-hidden="true">
          →
        </span>
      </Link>
    </section>
  );
}
