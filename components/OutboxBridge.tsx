"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { flushOutbox } from "@/lib/outbox";

/**
 * Reenvía lo que quedó pendiente en el dispositivo: la jugada que se pagó y no
 * alcanzó a registrarse, o la marca de una partida terminada justo cuando se
 * cerró la app. Corre al abrir (una vez por carga) y cuando vuelve la conexión.
 *
 * Vive en el árbol de providers, no en la pantalla del juego: el jugador puede
 * volver a abrir la app en /perfil o /historial y el envío pendiente tiene que
 * salir igual.
 */
export default function OutboxBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    async function flush() {
      const delivered = await flushOutbox();
      // Si entró una marca atrasada, el ranking en pantalla ya no es el bueno.
      if (delivered > 0 && !cancelled) {
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      }
    }

    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [queryClient]);

  return null;
}
