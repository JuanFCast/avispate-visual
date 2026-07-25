"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import TurnstileGate from "./TurnstileGate";

/**
 * Cuando un usuario de correo termina de crear su wallet embebida de Privy,
 * pide a /api/welcome-gas los ~0.1 CELO que necesita para firmar su primera
 * `play()` (la jugada gratis también es transacción). El endpoint es
 * idempotente, así que repetir la llamada es seguro. No aplica a wallets
 * externas ni MiniPay: esas pagan su propio gas (o lo pagan en USDT).
 *
 * Dos fases: preflight sin token (los que ya lo recibieron pasan sin ver
 * captcha) y, si el servidor pide captcha para una dirección nueva, se monta
 * TurnstileGate y se reintenta con el token.
 */
export default function WelcomeGasBridge() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const handledRef = useRef<string | null>(null);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);

  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const address =
    ready && authenticated && embedded ? embedded.address.toLowerCase() : null;
  const email = user?.email?.address ?? null;

  const fire = useCallback(
    async (turnstileToken: string | null) => {
      if (!address) return;
      const res = await fetch("/api/welcome-gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, email, turnstileToken }),
      });
      if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        if ((data as { error?: string }).error === "captcha-required") {
          setNeedsCaptcha(true);
          return;
        }
      }
      // Cualquier otra respuesta (200, 403, 500…) cierra esta ronda.
      setNeedsCaptcha(false);
    },
    [address, email]
  );

  // Preflight: una vez por dirección y carga de página.
  useEffect(() => {
    if (!address || handledRef.current === address) return;
    handledRef.current = address;
    fire(null).catch(() => {
      // Error transitorio de red: permitir reintento en el próximo render.
      handledRef.current = null;
    });
  }, [address, fire]);

  const onToken = useCallback(
    (token: string) => {
      setNeedsCaptcha(false);
      fire(token).catch(() => setNeedsCaptcha(true));
    },
    [fire]
  );

  return needsCaptcha ? <TurnstileGate onToken={onToken} /> : null;
}
