"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ROOM_CODE_LENGTH,
  ROOM_CODE_PREFIX,
  normalizeRoomCode,
  roomCodeBody,
  roomIsFull,
  type RoomError,
  type RoomView,
} from "@/lib/arena-rooms";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import ArenaHeader from "./ArenaHeader";

/**
 * Cada motivo por el que un código no sirve, con su salida.
 *
 * Que los cuatro dijeran "no se pudo" era el problema: "no existe" se arregla
 * revisando los dígitos, "ya empezó" no se arregla de ninguna manera y lo único
 * que queda es armar otra sala. Un error sin salida es un callejón.
 */
type JoinProblem = {
  messageKey: MessageKey;
  /** Null = el error se resuelve escribiendo otra vez; no hace falta enlace. */
  exit: { labelKey: MessageKey; href: string } | null;
};

const CREATE_EXIT = { labelKey: "join.exit.create" as MessageKey, href: "/arena/crear" };

/**
 * /arena/codigo — entrar con el código de un amigo. Ni un control más.
 *
 * Esta pantalla no configura NADA, y esa es toda su razón de ser. Antes pedía
 * entrada y jugadores antes de saber si iban a servir para algo, y cuando el
 * jugador terminaba escribiendo un código, todo lo que había elegido se tiraba
 * a la basura: en una sala manda quien la armó. Preguntar algo que vas a
 * ignorar es peor que no preguntarlo.
 *
 * "Buscar sala" tampoco sienta a nadie: comprueba que la sala existe y lleva a
 * verla. La silla se toma allí, con la entrada y las cartas del anfitrión ya a
 * la vista. Mirar una sala y entrar a ella siguen siendo dos actos distintos.
 */
export default function ArenaJoin() {
  const t = useT();
  const router = useRouter();

  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<JoinProblem | null>(null);

  /**
   * Completo = lo que se escribió forma un código válido. Se pregunta a la
   * misma función que valida en el servidor, en vez de contar caracteres aquí:
   * los códigos nuevos tienen seis y los viejos cuatro, y esta pantalla no
   * tiene por qué saberse esa historia.
   */
  const code = normalizeRoomCode(body);
  const complete = Boolean(code);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) return;
    setProblem(null);
    setBusy(true);

    try {
      // Sin token: leer una sala no la toca ni ocupa nada en ella.
      const res = await fetch(`/api/arena/rooms/${code}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const error = (data?.error as RoomError) ?? "server_error";
        setProblem(
          error === "room_not_found" || error === "invalid_code"
            ? { messageKey: "join.error.not_found", exit: null }
            : { messageKey: "room.error.generic", exit: null }
        );
        return;
      }

      const room = data as RoomView;
      if (room.status === "closed") {
        setProblem({
          messageKey: "join.error.cancelled",
          exit: { labelKey: "join.exit.arena", href: "/arena" },
        });
        return;
      }
      if (room.matchStarted) {
        setProblem({ messageKey: "join.error.started", exit: CREATE_EXIT });
        return;
      }
      // Quien ya tiene silla en esa sala vuelve a ella aunque esté llena: la
      // llenó él. "Llena" solo es un muro para quien está fuera.
      if (!room.you && roomIsFull(room)) {
        setProblem({ messageKey: "join.error.full", exit: CREATE_EXIT });
        return;
      }

      router.push(`/arena/sala/${room.code}`);
    } catch {
      setProblem({ messageKey: "room.error.generic", exit: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ArenaHeader backHref="/arena" title={t("join.title")} lead={t("join.lead")} />

      <form className="arena-card arena-setup" onSubmit={lookup}>
        <div className="field">
          <label htmlFor="room-code">{t("room.join.label")}</label>
          {/*
            El `AVP-` es nuestro, no del jugador: va impreso dentro del campo y
            no se puede borrar. Antes era un placeholder acompañado de una nota
            que explicaba que no había que escribirlo — una instrucción para
            arreglar un campo que estaba mal hecho.
          */}
          <div className="room-code-field">
            <span className="room-code-prefix" aria-hidden="true">
              {ROOM_CODE_PREFIX}-
            </span>
            <input
              id="room-code"
              className="room-code-input"
              value={body}
              onChange={(e) => {
                // Acepta lo que la gente pega de verdad: `AVP-H7K2MP`,
                // `h7k2mp`, `avp h7k2mp`, y también los códigos viejos de
                // cuatro dígitos. Y corrige al vuelo las confusiones de
                // siempre: la O que era un cero, la I o la ele que eran un uno.
                setBody(roomCodeBody(e.target.value));
                setProblem(null);
              }}
              // `text`, no `numeric`: los códigos llevan letras desde que
              // adivinarlos dejó de ser una travesura y pasó a costar dinero.
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="H7K2MP"
              aria-describedby="room-code-hint"
            />
          </div>
        </div>

        <p id="room-code-hint" className="arena-prize-note">
          {t("join.hint")}
        </p>

        {problem && (
          <div className="room-problem" role="alert">
            <p className="room-error">{t(problem.messageKey)}</p>
            {problem.exit && (
              <Link className="room-problem-exit" href={problem.exit.href}>
                {t(problem.exit.labelKey)}
              </Link>
            )}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={busy || !complete}>
          {busy ? t("room.join.looking") : t("join.cta")}
        </button>
      </form>
    </>
  );
}
