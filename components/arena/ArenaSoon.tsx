import Link from "next/link";
import { arenaPrize, fmtEntry, fmtUsdt } from "@/lib/arena";
import { getServerT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n";
import ArenaPlayers from "./ArenaPlayers";

interface Props {
  titleKey: MessageKey;
  textKey: MessageKey;
  entryUnits: bigint;
  players: number;
}

/**
 * Destino temporal de los dos modos: repite la mesa que se acaba de elegir y
 * dice sin rodeos que todavía no se puede jugar. Existe para que el lobby sea
 * un camino de verdad y no un botón muerto; cuando haya emparejamiento y salas
 * esta pantalla se cae y en su sitio queda la partida.
 */
export default async function ArenaSoon({
  titleKey,
  textKey,
  entryUnits,
  players,
}: Props) {
  const t = await getServerT();
  const prize = arenaPrize(entryUnits, players);

  return (
    <section className="arena-card arena-hero" aria-label={t("arena.aria")}>
      <span className="arena-tag">{t("arena.tag")}</span>

      <div className="arena-art">
        <ArenaPlayers />
      </div>

      <h1 className="arena-hero-title">{t(titleKey)}</h1>
      <p className="arena-hero-text">{t(textKey)}</p>

      <dl className="arena-recap">
        <div className="arena-recap-item">
          <dt>{t("arena.entry.label")}</dt>
          <dd>{fmtEntry(entryUnits)} USDT</dd>
        </div>
        <div className="arena-recap-item">
          <dt>{t("arena.players.label")}</dt>
          <dd>
            {players} {t("arena.players.unit")}
          </dd>
        </div>
        <div className="arena-recap-item arena-recap-win">
          <dt>{t("arena.prize.winner")}</dt>
          <dd>{fmtUsdt(prize.winnerUnits)} USDT</dd>
        </div>
      </dl>

      <Link className="lobby-ranking-link" href="/arena">
        {t("arena.soon.back_lobby")}
      </Link>
    </section>
  );
}
