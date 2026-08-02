"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";

/**
 * Encabezado de las pantallas de la Arena: volver, título y frase.
 *
 * La flecha va ARRIBA y no como enlace al final del scroll, que es donde
 * estaba. Volver es una salida, no una conclusión: quien se equivocó de camino
 * se da cuenta al llegar, no después de leerlo todo.
 *
 * Es un enlace de verdad y no `history.back()` porque a estas pantallas se
 * llega también desde un chat o desde un enlace compartido, y en ese caso
 * "atrás" no lleva a la Arena — lleva fuera de la app.
 */
export default function ArenaHeader({
  backHref,
  title,
  lead,
}: {
  backHref: string;
  title: string;
  lead?: string;
}) {
  const t = useT();

  return (
    <header className="arena-head-bar">
      <div className="arena-head-nav">
        <Link className="arena-back" href={backHref} aria-label={t("common.back")}>
          <span aria-hidden="true">←</span>
        </Link>
      </div>
      <h1 className="page-title">{title}</h1>
      {lead && <p className="page-lead">{lead}</p>}
    </header>
  );
}
