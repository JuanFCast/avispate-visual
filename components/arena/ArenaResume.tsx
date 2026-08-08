"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useProfile } from "@/lib/profile-context";
import { useT } from "@/lib/i18n/client";

interface Active {
  code: string;
  /** La mesa ya repartió: no es una sala esperando, es una partida corriendo. */
  inMatch: boolean;
}

/**
 * "Todavía tienes una sala abierta", en la primera pantalla de la Arena.
 *
 * Vive aquí y no en la de crear porque el que cerró la pestaña y volvió a
 * abrir la app no aterriza en la de crear: aterriza en /arena, y sin este aviso
 * su única pista sería acordarse del código. Además, crear otra sala cierra la
 * que tenía —un jugador ocupa una silla a la vez—, así que enterarse ANTES de
 * entrar a configurar es enterarse a tiempo.
 *
 * Son DOS avisos y no uno. Una sala esperando gente y una partida ya empezada
 * se sentían igual aquí —el mismo texto, el mismo botón— y no son lo mismo: de
 * la primera te puedes ir sin que nadie lo note, y en la segunda hay alguien
 * al otro lado esperando tu carta. Cada una lleva a su pantalla, además: a la
 * partida se entra derecho, sin pasar por la sala y su redirección.
 *
 * Las mesas de partidas ya terminadas no aparecen: se cierran al terminar. Este
 * aviso llegó a ofrecer "volver a mi sala" a una partida jugada y acabada, que
 * era la pared con la que se topaba el que solo quería jugar otra.
 *
 * No pinta nada cuando no hay sala, ni ocupa sitio mientras se averigua.
 */
export default function ArenaResume() {
  const t = useT();
  const { ready, authenticated, getToken } = useProfile();
  const [active, setActive] = useState<Active | null>(null);

  useEffect(() => {
    if (!ready || !authenticated) {
      setActive(null);
      return;
    }
    let alive = true;
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const res = await fetch("/api/arena/rooms/active", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (!alive || !res.ok) return;
        setActive(
          data?.code
            ? { code: data.code as string, inMatch: Boolean(data.inMatch) }
            : null
        );
      } catch {
        // Sin respuesta no se inventa una sala: simplemente no se ofrece volver.
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, authenticated, getToken]);

  if (!active) return null;

  const { code, inMatch } = active;

  return (
    <section className="arena-card room-resume">
      <div className="room-resume-body">
        <strong>{inMatch ? t("room.resume.match.title") : t("room.resume.title")}</strong>
        <small>
          {inMatch
            ? t("room.resume.match.text", { code })
            : t("room.resume.text", { code })}
        </small>
      </div>
      <Link
        className="room-resume-cta"
        href={inMatch ? `/arena/partida/${code}` : `/arena/sala/${code}`}
      >
        {inMatch ? t("room.resume.match.cta") : t("room.resume.cta")}
      </Link>
    </section>
  );
}
