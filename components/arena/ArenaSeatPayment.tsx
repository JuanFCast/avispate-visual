"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useArenaJoin, type JoinStage } from "@/lib/arena-join";
import { seatPaymentFor, seatTokenFor } from "@/lib/seat-token-client";
import { ARENA_COMMISSION_BPS, fmtEntry } from "@/lib/arena";
import { useIsMiniPay } from "@/lib/minipay";
import { MINIPAY_ADD_CASH } from "@/lib/tokens";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";

/**
 * El puente a RainbowKit, igual que en el reto individual: es el único sitio
 * que llama a `useConnectModal`, se pide bajo demanda y NUNCA dentro de
 * MiniPay (su reglamento prohíbe ofrecer otra wallet, y además ya hay una).
 */
const ConnectModalBridge = dynamic(
  () => import("../wallet/ConnectModalBridge"),
  { ssr: false }
);

/** Igual que en el reto individual: el único error que se arregla recargando. */
const FUNDS_ERROR: MessageKey = "pay.error.insufficient";

/**
 * Los avisos que se resuelven CONECTANDO la billetera correcta, no
 * reintentando el pago.
 *
 * Es el agujero que esta pantalla tenía: los pintaba como texto suelto —
 * "Conecta la tuya para jugar"— sin un solo botón que permitiera conectarla.
 * El reto diario sí ofrecía esa salida (`lobby-block` en
 * `DailyChallengeCard`), así que la misma cuenta bloqueada podía arreglarse
 * desde la portada y era un callejón sin salida desde la Arena.
 */
const WALLET_ERRORS: readonly MessageKey[] = [
  "pay.block.wrong_wallet",
  "pay.block.reconnect",
  "pay.block.account_changed",
];

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
  const inMiniPay = useIsMiniPay();
  const { stage, error, clearError, payAndSit, finishPending } = useArenaJoin();
  /**
   * La entrega `ConnectModalBridge` cuando RainbowKit está listo — igual que
   * en `GameShell`. Empieza en `null`, así que el botón nunca promete abrir
   * algo que todavía no existe.
   */
  const [openConnectModal, setOpenConnectModal] = useState<(() => void) | null>(
    null
  );
  const onConnectModalReady = useCallback((open: () => void) => {
    setOpenConnectModal(() => open);
  }, []);
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

  /**
   * La salida cuando la billetera es el problema. Reutiliza el conector de
   * siempre: abrir el modal es lo que le da a la extensión la ocasión de
   * pedir la contraseña, y al volver nada se da por bueno — el siguiente
   * toque en Pagar revalida TODO desde el primer paso del guardián.
   *
   * Dentro de MiniPay no se ofrece conectar: ahí "reintentar" es limpiar el
   * aviso y volver a preguntarle a la wallet que ya está puesta.
   */
  function reconnectWallet() {
    clearError();
    if (!inMiniPay) openConnectModal?.();
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

  const walletBlocked = error !== null && WALLET_ERRORS.includes(error);

  return (
    <div className="panel arena-pay">
      {/* Fuera de MiniPay únicamente: sin esto, el aviso de "conecta la tuya"
          no tenía forma de cumplirse desde esta pantalla. */}
      {!inMiniPay && <ConnectModalBridge onReady={onConnectModalReady} />}

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
          {/* Faltó USDT: el camino de recarga va pegado al aviso, igual que en
              el reto individual. Solo dentro de MiniPay — fuera de ahí la
              cartera del perfil ya trae bridge/swap, y aquí no hay sitio
              para repetir esas tres opciones. */}
          {error === FUNDS_ERROR && inMiniPay && (
            <>
              {" "}
              <a className="lobby-addcash" href={MINIPAY_ADD_CASH}>
                {t("lobby.addcash")}
              </a>
            </>
          )}
        </p>
      )}

      {/* El problema es la billetera, así que la acción es la billetera — no
          volver a tocar Pagar, que daría exactamente el mismo aviso. Mismo
          texto y mismo par de casos que el reto diario. */}
      {walletBlocked && !busy && (
        <button
          type="button"
          className="access-btn access-btn-primary"
          onClick={reconnectWallet}
        >
          {t(inMiniPay ? "pay.action.retry" : "pay.action.connect")}
        </button>
      )}
    </div>
  );
}
