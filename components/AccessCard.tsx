"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useAccountModal } from "@rainbow-me/rainbowkit";
import { useIsMiniPay } from "@/lib/minipay";
import { useWalletAuth } from "@/lib/wallet-auth";
import { shortAddress } from "@/lib/wallet";
import { useT } from "@/lib/i18n/client";
import WalletConnect from "./WalletConnect";

/**
 * Cómo se entra a Avíspate. Dos caminos, y los DOS dan identidad de verdad.
 *
 * Antes esta tarjeta ofrecía el correo como identidad y la wallet como medio de
 * pago, así que un jugador con su wallet conectada veía su propia dirección en
 * pantalla y aun así tenía que sacar el correo para poder hacer algo. La
 * dirección estaba ahí, pero no probaba nada ante el servidor.
 *
 * Ahora, cuando hay wallet conectada, el botón principal dice qué falta —
 * "Continuar con esta wallet"— y al tocarlo pide la firma que abre la sesión.
 * Ninguna pantalla vuelve a enseñar una dirección como si ya estuviera lista.
 *
 * El correo no se va a ninguna parte: sigue siendo el camino por defecto para
 * quien no tiene wallet, y el que crea la wallet embebida.
 */
export default function AccessCard() {
  const t = useT();
  const { login } = usePrivy();
  const { openAccountModal } = useAccountModal();
  const { needsSignature, address, stage, error, continueWithWallet } =
    useWalletAuth();
  const inMiniPay = useIsMiniPay();

  const busy = stage !== null;

  // Dentro de MiniPay esta tarjeta no tiene nada que ofrecer: la wallet ya
  // entró sola, el correo sobra y la firma —que es lo que abriría la sesión—
  // no existe como método. Lo que sí abre sesión ahí es jugar, así que la
  // tarjeta se convierte en el empujón hacia el reto del día. Enseñar aquí un
  // botón de "conectar" sería, además, justo lo que MiniPay penaliza.
  if (inMiniPay) {
    return (
      <div className="access-card">
        <p className="access-minipay-hint">{t("access.minipay_hint")}</p>
        <Link href="/" className="access-btn access-btn-primary">
          {t("access.minipay_cta")}
        </Link>
      </div>
    );
  }

  return (
    <div className="access-card">
      {needsSignature && address ? (
        <>
          <button
            type="button"
            className="access-btn access-btn-primary"
            onClick={continueWithWallet}
            disabled={busy}
            aria-busy={busy}
          >
            {stage === "signing"
              ? t("access.wallet_signing")
              : stage === "verifying"
                ? t("access.wallet_verifying")
                : t("access.wallet_continue")}
          </button>
          {/* La dirección va DEBAJO del botón y en pequeño: es el dato que
              confirma con cuál vas a entrar, no la prueba de que ya entraste. */}
          <small className="access-wallet-hint">
            {t("access.wallet_will_sign", { address: shortAddress(address) })}
          </small>
          <button
            type="button"
            className="access-switch"
            onClick={() => openAccountModal?.()}
            disabled={!openAccountModal || busy}
          >
            {t("access.wallet_other")}
          </button>
        </>
      ) : (
        <WalletConnect
          className="access-btn access-btn-primary"
          label={t("access.wallet_connect")}
        />
      )}

      {error && (
        <p className="room-error">
          {t(
            error === "rejected"
              ? "access.error.rejected"
              : error === "not_enabled"
                ? "access.error.not_enabled"
                : "access.error.failed"
          )}
        </p>
      )}

      <div className="access-sep">
        <span>{t("access.or")}</span>
      </div>

      <button
        type="button"
        className="access-btn access-btn-secondary"
        onClick={() => login()}
        disabled={busy}
      >
        {t("access.email")}
      </button>
    </div>
  );
}
