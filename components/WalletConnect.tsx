"use client";

import { useConnectModal, useAccountModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/wallet";
import { useT } from "@/lib/i18n/client";

interface Props {
  /** Clase del botón para adaptarlo a distintos sitios (acceso, perfil…). */
  className?: string;
  /** Texto del botón cuando no hay wallet conectada. Por defecto, "Conectar wallet". */
  label?: string;
  /**
   * Texto cuando SÍ hay wallet conectada. Si se omite, muestra la dirección
   * abreviada. Útil para un botón de "Cambiar wallet" que no repita la dirección.
   */
  connectedLabel?: string;
}

/**
 * Botón único de wallet: si no hay ninguna conectada abre el modal de RainbowKit
 * para elegir (MetaMask, Rabby, Coinbase, WalletConnect, embebida…). Si ya hay
 * una activa, muestra la dirección abreviada y abre el modal de cuenta para
 * cambiar o desconectar. Refleja la ÚNICA wallet activa de wagmi.
 */
export default function WalletConnect({
  className = "access-btn access-btn-secondary",
  label,
  connectedLabel,
}: Props) {
  const t = useT();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => (openAccountModal ? openAccountModal() : disconnect())}
        title={t("access.wallet_title")}
      >
        {connectedLabel ?? shortAddress(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => openConnectModal?.()}
      disabled={!openConnectModal}
    >
      {label ?? t("access.wallet_connect")}
    </button>
  );
}
