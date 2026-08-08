"use client";

import { useState } from "react";
import { useArenaJoin, type JoinStage } from "@/lib/arena-join";
import { seatPaymentFor, seatTokenFor } from "@/lib/seat-token-client";
import { ARENA_COMMISSION_BPS, fmtEntry } from "@/lib/arena";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";

const STAGE_KEY: Record<JoinStage, MessageKey> = {
  checking: "arena.pay.stage.checking",
  approving: "arena.pay.stage.approving",
  confirm: "arena.pay.stage.confirm",
  confirming: "arena.pay.stage.confirming",
  registering: "arena.pay.stage.registering",
  claiming: "arena.pay.stage.claiming",
};

interface Props {
  code: string;
  /** Mesa en el contrato. Este componente solo se monta si existe. */
  tableId: string;
  entryUnits: bigint;
  maxPlayers: number;
  authHeaders: () => Promise<HeadersInit>;
  /** Ya sentado: la sala se recarga para que aparezca la silla. */
  onSeated: () => void;
}

/**
 * La puerta de una mesa con entrada: pagar y sentarse.
 *
 * Sale para TODO el mundo que aún no tiene silla, incluido el anfitrión — que
 * con escrow tampoco se sienta al crear la sala. Que quien monta la partida
 * pague como los demás no es una regla que hayamos añadido: es que hasta que la
 * sala no existe no hay código, y sin código no hay mesa que pagar.
 */
export default function ArenaSeatPayment({
  code,
  tableId,
  entryUnits,
  maxPlayers,
  authHeaders,
  onSeated,
}: Props) {
  const t = useT();
  const { stage, error, payAndSit, finishPending } = useArenaJoin();
  /**
   * ¿Hay un pago hecho en este dispositivo que el servidor no aceptó todavía?
   *
   * Mientras lo haya, esta pantalla NO puede ofrecer pagar. El dinero ya salió;
   * lo único que falta es contarlo. Pasó en la primera prueba real: el registro
   * se cayó por un retraso del nodo y el jugador se quedó viendo un botón de
   * pagar, que es justo lo que no debía tocar.
   */
  const [pendiente, setPendiente] = useState<boolean>(() =>
    Boolean(seatPaymentFor(code))
  );
  const [alreadyPaid] = useState(() => Boolean(seatTokenFor(code)));

  const busy = stage !== null;
  const entry = fmtEntry(entryUnits);
  const commission = Number(ARENA_COMMISSION_BPS) / 100;

  async function pay() {
    const ok = await payAndSit({
      code,
      tableId: tableId as `0x${string}`,
      entryUnits,
      maxPlayers,
      authHeaders,
    });
    setPendiente(Boolean(seatPaymentFor(code)));
    if (ok) onSeated();
  }

  /** Termina un pago ya hecho. No firma ni cobra nada. */
  async function finish() {
    const ok = await finishPending({
      code,
      tableId: tableId as `0x${string}`,
      authHeaders,
    });
    setPendiente(Boolean(seatPaymentFor(code)));
    if (ok) onSeated();
  }

  return (
    <div className="panel arena-pay">
      <h3 className="arena-pay-title">{t("arena.pay.title")}</h3>
      <p className="hint">
        {t("arena.pay.support", { entry, commission: String(commission) })}
      </p>

      <button
        type="button"
        className="btn-primary"
        onClick={pendiente ? finish : pay}
        disabled={busy}
        aria-busy={busy}
      >
        {busy
          ? t(STAGE_KEY[stage])
          : pendiente
            ? t("arena.pay.finish")
            : t("arena.pay.button", { entry })}
      </button>

      {pendiente && !busy && (
        <p className="hint" aria-live="polite">
          {t("arena.pay.already_paid")}
        </p>
      )}

      {alreadyPaid && !busy && (
        <p className="hint" aria-live="polite">
          {t("arena.pay.seated")}
        </p>
      )}

      {error && (
        <p className="alias-error" aria-live="polite">
          {t(error, { entry })}
        </p>
      )}
    </div>
  );
}
