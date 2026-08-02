"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useProfile } from "@/lib/profile-context";
import { useT } from "@/lib/i18n/client";

/**
 * "Todavía tienes una sala abierta", en la primera pantalla de la Arena.
 *
 * Vive aquí y no en la de crear porque el que cerró la pestaña y volvió a
 * abrir la app no aterriza en la de crear: aterriza en /arena, y sin este aviso
 * su única pista sería acordarse del código. Además, crear otra sala cierra la
 * que tenía —un jugador ocupa una silla a la vez—, así que enterarse ANTES de
 * entrar a configurar es enterarse a tiempo.
 *
 * No pinta nada cuando no hay sala, ni ocupa sitio mientras se averigua.
 */
export default function ArenaResume() {
  const t = useT();
  const { ready, authenticated, getToken } = useProfile();
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated) {
      setCode(null);
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
        if (alive && res.ok) setCode(data?.code ?? null);
      } catch {
        // Sin respuesta no se inventa una sala: simplemente no se ofrece volver.
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, authenticated, getToken]);

  if (!code) return null;

  return (
    <section className="arena-card room-resume">
      <div className="room-resume-body">
        <strong>{t("room.resume.title")}</strong>
        <small>{t("room.resume.text", { code })}</small>
      </div>
      <Link className="room-resume-cta" href={`/arena/sala/${code}`}>
        {t("room.resume.cta")}
      </Link>
    </section>
  );
}
