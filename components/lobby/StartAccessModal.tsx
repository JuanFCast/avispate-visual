"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useProfile } from "@/lib/profile-context";
import { useActiveWallet, shortAddress } from "@/lib/wallet";
import { useWalletAuth } from "@/lib/wallet-auth";
import { useIsMiniPay } from "@/lib/minipay";
import { useT } from "@/lib/i18n/client";
import AliasGate from "../AliasGate";
import WalletAliasForm from "../WalletAliasForm";
import WalletConnect from "../WalletConnect";

interface Props {
  walletAlias: string | null;
  /** Ya sabemos si la wallet conectada tiene alias en el servidor. */
  walletAliasReady: boolean;
  onSetWalletAlias: (alias: string) => void;
  onClose: () => void;
}

/**
 * Acceso contextual: se abre solo al tocar el CTA sin identidad. Correo,
 * wallet y alias viven aquí; al completarse, el modal se cierra y se vuelve
 * al lobby con el mazo conservado. Nunca inicia partida ni pago por sí solo.
 */
export default function StartAccessModal({
  walletAlias,
  walletAliasReady,
  onSetWalletAlias,
  onClose,
}: Props) {
  const t = useT();
  const { login } = usePrivy();
  const profile = useProfile();
  const wallet = useActiveWallet();
  const inMiniPay = useIsMiniPay();
  const walletAuth = useWalletAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * ¿El alias de la sesión ya nombra a la wallet conectada? Solo si es SU
   * dirección. Con una wallet externa distinta no la nombra, y el ranking
   * mostraría a un jugador sin nombre.
   */
  const sessionCoversWallet = Boolean(
    profile.alias &&
      profile.walletAddress &&
      wallet.address &&
      profile.walletAddress === wallet.address.toLowerCase()
  );

  /**
   * Wallet puesta y todavía sin sesión: falta la firma. Fuera de MiniPay es un
   * paso obligatorio —conectar no es entrar—, dentro no existe como método y la
   * sesión la abre la propia jugada.
   */
  const needsSignIn =
    !inMiniPay && !wallet.reconnecting && walletAuth.needsSignature;
  const signing = walletAuth.stage !== null;

  const needsEmailAlias =
    profile.authenticated && !profile.loading && !profile.alias;
  /**
   * Se pide alias para la wallet cuando ya se confirmó que no tiene ninguno.
   *
   * Sin mirar si hay sesión de correo, a propósito: el puntaje se guarda contra
   * la wallet que FIRMA, así que una wallet externa sin nombre necesita elegir
   * uno aunque su dueño tenga la sesión abierta con otro. Mirar solo la sesión
   * es lo que dejó a Juan pagando una partida que no se podía guardar
   * (2026-08-07).
   */
  /**
   * Y no se pide mientras el perfil todavía está llegando.
   *
   * `sessionCoversWallet` compara la wallet conectada con la del PERFIL, y justo
   * después de firmar el perfil aún no ha llegado: `profile.walletAddress` es
   * null, así que la comparación da falso y esto pedía un alias que el jugador
   * ya tiene. Se veía como un parpadeo — el formulario de alias aparecía un
   * instante y desaparecía solo en cuanto el perfil entraba.
   *
   * Es el mismo error de siempre con otra cara: contestar "no" a una pregunta
   * cuya respuesta todavía es "no lo sé". Mientras se sepa, se espera.
   */
  const sessionSettling = profile.authenticated && profile.loading;
  const needsWalletAlias =
    wallet.isConnected &&
    walletAliasReady &&
    !walletAlias &&
    !sessionCoversWallet &&
    !sessionSettling;
  const checkingWalletAlias =
    wallet.isConnected &&
    !sessionCoversWallet &&
    (!walletAliasReady || sessionSettling);

  /**
   * Identidad completa → volver al lobby (sin countdown ni cobro automático).
   *
   * "Completa" incluye el nombre de la wallet: cerrar antes devolvía al jugador
   * a un botón de jugar que iba a rechazarle la partida. Y fuera de MiniPay
   * exige SESIÓN, no solo wallet conectada: desde que firmar es obligatorio,
   * una dirección puesta sin firma todavía no es una cuenta.
   */
  const identified = inMiniPay
    ? profile.authenticated || wallet.isConnected
    : profile.authenticated && !profile.loading;
  const pending =
    needsEmailAlias || needsSignIn || needsWalletAlias || checkingWalletAlias;
  useEffect(() => {
    if (identified && !pending) onClose();
  }, [identified, pending, onClose]);

  // Foco inicial dentro del diálogo; al cerrar vuelve al CTA del lobby.
  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>("button, input, a[href]")
      ?.focus();
    return () => {
      document.querySelector<HTMLElement>(".lobby-cta")?.focus();
    };
  }, []);

  // Scroll del fondo bloqueado mientras el modal esté abierto.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape cierra y Tab queda atrapado dentro del diálogo.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, a[href], [tabindex]'
        )
      ).filter((el) => el.tabIndex !== -1);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="lobby-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="lobby-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-modal-title"
      >
        <button
          type="button"
          className="lobby-modal-close"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          ✕
        </button>

        {needsEmailAlias ? (
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              {t("access.alias_title")}
            </h2>
            <AliasGate />
          </>
        ) : needsSignIn ? (
          /**
           * El paso que convierte una wallet conectada en una cuenta. La firma
           * es gratis y no mueve fondos; el texto lo dice porque la ventana de
           * la wallet asusta si no se sabe qué se está firmando.
           */
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              {t("access.title")}
            </h2>
            <button
              type="button"
              className="access-btn access-btn-primary"
              onClick={walletAuth.continueWithWallet}
              disabled={signing}
              aria-busy={signing}
            >
              {walletAuth.stage === "signing"
                ? t("access.wallet_signing")
                : walletAuth.stage === "verifying"
                  ? t("access.wallet_verifying")
                  : t("access.wallet_continue")}
            </button>
            {walletAuth.address && (
              <small className="access-wallet-hint">
                {t("access.wallet_will_sign", {
                  address: shortAddress(walletAuth.address),
                })}
              </small>
            )}
            {walletAuth.error && (
              <p className="room-error">
                {t(
                  walletAuth.error === "rejected"
                    ? "access.error.rejected"
                    : walletAuth.error === "not_enabled"
                      ? "access.error.not_enabled"
                      : "access.error.failed"
                )}
              </p>
            )}
            <button
              type="button"
              className="lobby-modal-later"
              onClick={onClose}
              disabled={signing}
            >
              {t("common.close")}
            </button>
          </>
        ) : needsWalletAlias ? (
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              {t("access.alias_title")}
            </h2>
            <WalletAliasForm onSet={onSetWalletAlias} />
          </>
        ) : checkingWalletAlias ||
          wallet.reconnecting ||
          (profile.authenticated && profile.loading) ? (
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              {t("access.title")}
            </h2>
            <p className="lobby-modal-text" aria-live="polite">
              {t("access.checking")}
            </p>
          </>
        ) : inMiniPay ? (
          /**
           * Dentro de MiniPay no se ofrece conectar NADA: la wallet ya entró
           * sola y su reglamento de listado prohíbe el botón de conectar
           * ("never show a Connect Wallet button when isMiniPay"). El correo
           * tampoco sirve de nada ahí, y la firma que abriría sesión no existe
           * como método en esa wallet. Lo que sí abre sesión es jugar, así que
           * el modal solo empuja de vuelta al reto del día.
           *
           * Es el mismo criterio que ya aplicaba `AccessCard` en la Arena; esta
           * pantalla se había quedado sin él.
           */
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              {t("access.title")}
            </h2>
            <p className="lobby-modal-text">{t("access.minipay_hint")}</p>
            <button
              type="button"
              className="access-btn access-btn-primary"
              onClick={onClose}
            >
              {t("access.minipay_cta")}
            </button>
          </>
        ) : (
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              {t("access.title")}
            </h2>
            <p className="lobby-modal-text">{t("access.text")}</p>
            {/* Solo correo dentro de la ventana de Privy. El método "wallet"
                sigue habilitado en la configuración —es el motor de la firma
                SIWE y sin él no se puede entrar con wallet—, pero enseñarlo
                también aquí ponía dos veces la misma puerta en la misma
                pantalla. La de wallet es el botón de abajo. */}
            <button
              type="button"
              className="access-btn access-btn-primary"
              onClick={() => login({ loginMethods: ["email"] })}
            >
              {t("access.email")}
            </button>
            <WalletConnect label={t("access.wallet")} />
            <button
              type="button"
              className="lobby-modal-later"
              onClick={onClose}
            >
              {t("common.close")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
