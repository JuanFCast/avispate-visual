"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";

interface MiniPayEthereum {
  isMiniPay?: boolean;
}

/**
 * ¿Estamos dentro del navegador de MiniPay (la wallet de Opera Mini sobre Celo)?
 * MiniPay expone su wallet como provider inyectado con la marca `isMiniPay`.
 * En desarrollo se puede forzar con `?minipay=1` para probar la UI.
 */
export function isMiniPay(): boolean {
  if (typeof window === "undefined") return false;
  const eth = (window as unknown as { ethereum?: MiniPayEthereum }).ethereum;
  if (eth?.isMiniPay) return true;
  if (process.env.NODE_ENV !== "production") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("minipay") === "1") return true;
  }
  return false;
}

/** Igual que `isMiniPay` pero seguro para hidratación: false hasta montar. */
export function useIsMiniPay(): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    setValue(isMiniPay());
  }, []);
  return value;
}

/**
 * Dentro de MiniPay, auto-conecta la wallet inyectada (la propia MiniPay). Solo
 * intenta una vez y solo si no hay ya una wallet activa, para no pisar otra
 * conexión ni duplicar intentos.
 */
export function useMiniPayAutoConnect(): void {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current || isConnected) return;
    if (!isMiniPay()) return;
    const injected = connectors.find(
      (c) => c.id === "injected" || c.type === "injected"
    );
    if (!injected) return;
    tried.current = true;
    connect({ connector: injected });
  }, [isConnected, connect, connectors]);
}
