"use client";

import { useConnectModal, useAccountModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/wallet";

interface Props {
  /** Clase del botón para adaptarlo a distintos sitios (acceso, perfil…). */
  className?: string;
  /** Texto del botón cuando no hay wallet conectada. */
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
  label = "Conectar wallet",
  connectedLabel,
}: Props) {
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
        title="Ver o cambiar wallet"
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
      {label}
    </button>
  );
}
