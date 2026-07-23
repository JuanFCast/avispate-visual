"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useProfile } from "@/lib/profile-context";
import { useActiveWallet } from "@/lib/wallet";
import AliasGate from "../AliasGate";
import WalletAliasForm from "../WalletAliasForm";
import WalletConnect from "../WalletConnect";

interface Props {
  walletAlias: string | null;
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
  onSetWalletAlias,
  onClose,
}: Props) {
  const { login } = usePrivy();
  const profile = useProfile();
  const wallet = useActiveWallet();
  const panelRef = useRef<HTMLDivElement>(null);

  // Identidad completa → volver al lobby (sin countdown ni cobro automático).
  const emailDone =
    profile.authenticated && !profile.loading && Boolean(profile.alias);
  const walletDone =
    !profile.authenticated && wallet.isConnected && Boolean(walletAlias);
  useEffect(() => {
    if (emailDone || walletDone) onClose();
  }, [emailDone, walletDone, onClose]);

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

  const needsEmailAlias =
    profile.authenticated && !profile.loading && !profile.alias;
  const needsWalletAlias =
    !profile.authenticated && wallet.isConnected && !walletAlias;

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
          aria-label="Cerrar"
        >
          ✕
        </button>

        {needsEmailAlias ? (
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              Elige tu alias
            </h2>
            <AliasGate />
          </>
        ) : needsWalletAlias ? (
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              Elige tu alias
            </h2>
            <WalletAliasForm onSet={onSetWalletAlias} />
          </>
        ) : profile.authenticated && profile.loading ? (
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              Guarda tu marca y compite
            </h2>
            <p className="lobby-modal-text" aria-live="polite">
              Comprobando tu perfil…
            </p>
          </>
        ) : (
          <>
            <h2 id="access-modal-title" className="lobby-modal-title">
              Guarda tu marca y compite
            </h2>
            <p className="lobby-modal-text">
              Entra para guardar tu tiempo, aparecer en el ranking y recibir
              premios.
            </p>
            <button
              type="button"
              className="access-btn access-btn-primary"
              onClick={() => login()}
            >
              Continuar con correo
            </button>
            <WalletConnect label="Ya tengo una wallet" />
            <button
              type="button"
              className="lobby-modal-later"
              onClick={onClose}
            >
              Ahora no
            </button>
          </>
        )}
      </div>
    </div>
  );
}
