"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import ArenaPlayers from "../arena/ArenaPlayers";

/**
 * Segunda tarjeta del inicio: el modo contra otras personas. Vive al lado del
 * reto diario para que al entrar se vea que Avíspate tiene dos formas de
 * jugar — solo o en la Arena — sin parecer un menú de opciones.
 *
 * Ya no lleva el badge "PRONTO" ni la fila de entradas. El badge sobraba porque
 * la Arena se puede jugar: se arma una sala, se comparte el código y se juega.
 * Las entradas sobraban por otra razón — eran tres fichas con precios que no se
 * podían tocar, y un precio que no responde al dedo parece un botón roto. La
 * entrada se elige al configurar la sala, que es donde significa algo.
 */
export default function ArenaCard() {
  const t = useT();

  return (
    <section className="arena-card" aria-label={t("arena.aria")}>
      <div className="arena-head">
        <h2 className="arena-title">{t("arena.title")}</h2>
        <p className="arena-support">{t("arena.support")}</p>
      </div>

      <div className="arena-art">
        <ArenaPlayers />
      </div>

      <Link className="arena-cta" href="/arena">
        {t("arena.cta")}
      </Link>
    </section>
  );
}
