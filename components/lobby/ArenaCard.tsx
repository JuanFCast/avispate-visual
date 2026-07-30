"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import ArenaEntries from "../arena/ArenaEntries";
import ArenaPlayers from "../arena/ArenaPlayers";

/**
 * Segunda tarjeta del inicio: el modo contra otras personas. Vive al lado del
 * reto diario para que al entrar se vea que Avíspate tiene dos formas de
 * jugar — solo o en la Arena — sin parecer un menú de opciones.
 *
 * Todavía no hay emparejamiento, pagos ni partidas: el botón solo lleva a
 * /arena, que cuenta lo que viene. Nada de esto toca el modo individual.
 */
export default function ArenaCard() {
  const t = useT();

  return (
    <section className="arena-card" aria-label={t("arena.aria")}>
      <div className="arena-head">
        <span className="arena-tag">{t("arena.tag")}</span>
        <h2 className="arena-title">{t("arena.title")}</h2>
        <p className="arena-support">{t("arena.support")}</p>
      </div>

      <div className="arena-art">
        <ArenaPlayers />
      </div>

      <ArenaEntries />

      <Link className="arena-cta" href="/arena">
        {t("arena.cta")}
      </Link>
    </section>
  );
}
