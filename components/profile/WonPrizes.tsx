"use client";

import { USDT_DECIMALS } from "@/lib/contracts";
import { useT } from "@/lib/i18n/client";

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

function fmtUsdt(units: string): string {
  return (Number(units) / 10 ** USDT_DECIMALS).toFixed(2);
}

/**
 * Historial de premios ganados (reales, de round_settlements ya pagados) más una
 * nota de que el pago es automático (Avíspate no usa "reclamar").
 */
export default function WonPrizes({ prizes, loading }: Props) {
  const t = useT();

  return (
    <section className="profile-section">
      <h2 className="section-title">{t("prizes.title")}</h2>
      <p className="section-note">
        {t("prizes.note.a")} <strong>{t("prizes.note.strong")}</strong>{" "}
        {t("prizes.note.b")}
      </p>

      {loading ? (
        <div className="prize-list">
          <span className="skeleton skeleton-row" />
          <span className="skeleton skeleton-row" />
        </div>
      ) : prizes.length === 0 ? (
        <p className="empty-note">{t("prizes.empty")}</p>
      ) : (
        <ul className="prize-list">
          {prizes.map((p, i) => (
            <li key={`${p.roundDate}-${p.deck}-${i}`} className="prize-item">
              <span className="prize-emoji" aria-hidden="true">
                🏆
              </span>
              <span className="prize-info">
                <span className="prize-amount">{fmtUsdt(p.amountUnits)} USDT</span>
                <small>
                  {t("prizes.deck", { deck: p.deck })} · {p.roundDate}
                </small>
              </span>
              {p.txHash ? (
                <a
                  className="prize-link"
                  href={`https://celoscan.io/tx/${p.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("prizes.view_aria")}
                >
                  {t("prizes.view")}
                </a>
              ) : (
                <span className="prize-status">{t("prizes.paid")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
