"use client";

import { useEffect, useRef } from "react";
import { useWallets } from "@privy-io/react-auth";
import { useConnect, useReconnect } from "wagmi";
import { useProfile } from "./profile-context";
import { useActiveWallet } from "./wallet";
import { useIsMiniPay } from "./minipay";
import { probeWallet } from "./wallet-access";
import {
  canonicalFromProfile,
  decideCanonicalReconnect,
  pickCanonicalConnector,
  EMBEDDED_WALLET_NAME,
  type ProbedConnector,
} from "./wallet-identity";

/**
 * Reengancha la wallet CANÓNICA externa al cargar, cuando se puede DEMOSTRAR
 * que sigue autorizada. El caso PipeRabby: correo + Rabby canónica + una
 * embebida de arrastre; al soltar la embebida no quedaba nada puesto y el lobby
 * pedía "conecta tu billetera" en cada visita.
 *
 * ── Por qué esto no regala nada ────────────────────────────────────────────
 *
 * Preguntar y pedir son cosas distintas. `probeWallet` acaba en `eth_accounts`,
 * que devuelve las cuentas YA autorizadas sin abrir ninguna ventana y contesta
 * lista vacía si la extensión está bloqueada o si el sitio no tiene permiso.
 * `eth_requestAccounts` —el que interrumpe— no se llama aquí ni por accidente:
 * `reconnect()` de wagmi entra por `connect({ isReconnecting: true })`, y ese
 * camino no lo alcanza (ver `@wagmi/core/connectors/injected.js`). El conector
 * solo se reengancha si ya estaba autorizado; si no, no pasa nada y el jugador
 * ve el botón de conectar de siempre.
 *
 * Y la wallet que queda activa es la canónica y ninguna otra:
 * `pickCanonicalConnector` exige que la PRIMERA cuenta del conector sea la
 * canónica, que es la que wagmi deja activa. Sin esa prueba: conexión manual.
 *
 * ── Y por qué no pelea con nadie ───────────────────────────────────────────
 *
 * Tres decisores, tres territorios que no se tocan, y se comprueba de forma
 * exhaustiva en `scripts/verify-canonical-reconnect.ts`:
 *
 *   · MiniPay (`useMiniPayAutoConnect`) — dentro del Mini App manda la
 *     inyectada; los otros dos se apagan con su primera línea.
 *   · La embebida (`decideEmbeddedAutoConnect`) — solo cuando la canónica ES la
 *     embebida (o no hay ninguna).
 *   · Esto — solo cuando la canónica es OTRA dirección, y solo si no hay ya
 *     una wallet puesta.
 *
 * Nada de esto firma ni paga: reenganchar no es ninguna de las dos cosas, y el
 * guardián completo (`decidePlayStart`) sigue corriendo entero en cada toque.
 */
export function useCanonicalReconnect(): void {
  const profile = useProfile();
  const { authenticated } = profile;
  const { isConnected, reconnecting } = useActiveWallet();
  const inMiniPay = useIsMiniPay();
  const { connectors } = useConnect();
  const { reconnect } = useReconnect();
  const { wallets } = useWallets();

  const embeddedAddress =
    wallets.find((w) => w.walletClientType === "privy")?.address ?? null;

  /**
   * La canónica, reducida a una CADENA.
   *
   * El efecto de abajo no puede depender del objeto `profile`: el proveedor
   * construye uno nuevo en cada render, así que el efecto se relanzaría siempre
   * y su limpieza cancelaría el sondeo en vuelo — y como la dirección ya
   * quedaría marcada como intentada, no se reengancharía JAMÁS. Es el mismo
   * error que dejó mudo al anuncio EIP-6963; aquí se evita comparando valores.
   */
  const canonical = canonicalFromProfile(profile);
  const canonicalKey =
    canonical.status === "known" ? canonical.address : canonical.status;

  /** `reconnect` de wagmi no promete identidad estable entre renders. */
  const reconnectRef = useRef(reconnect);
  useEffect(() => {
    reconnectRef.current = reconnect;
  });

  /**
   * Canónicas ya intentadas, una vez cada una.
   *
   * Un solo intento a propósito: si la extensión estaba bloqueada, insistir no
   * la desbloquea —eso lo hace la persona— y reintentar en bucle sería la
   * pelea que este archivo existe para no tener. La salida cuando no se puede
   * demostrar nada es la de siempre y está a un toque: conectar a mano.
   */
  const intentadas = useRef<Set<string>>(new Set());

  useEffect(() => {
    const decision = decideCanonicalReconnect({
      inMiniPay,
      authenticated,
      isConnected,
      reconnecting,
      canonical:
        canonicalKey === "loading" || canonicalKey === "none"
          ? { status: canonicalKey }
          : { status: "known", address: canonicalKey },
      embeddedAddress,
    });
    if (decision.kind !== "probe") return;
    if (intentadas.current.has(decision.canonical)) return;
    intentadas.current.add(decision.canonical);

    let cancelado = false;

    (async () => {
      /**
       * Solo conectores inyectados, y nunca la embebida.
       *
       * Los de sesión remota (WalletConnect, Coinbase) no pueden demostrar nada
       * en silencio —hay que abrirles una sesión, que es justo la ventana que
       * no queremos— así que quedan fuera y siguen conectándose a mano.
       */
      const candidatos = connectors.filter(
        (c) => c.type === "injected" && c.name !== EMBEDDED_WALLET_NAME
      );
      if (candidatos.length === 0) return;

      // En paralelo: preguntarle a seis extensiones de una en una, con el tope
      // de `probeWallet` cada vez, tardaría más que la paciencia de cualquiera.
      const probed: ProbedConnector[] = await Promise.all(
        candidatos.map(async (c) => {
          const probe = await probeWallet(c);
          return {
            id: c.id,
            name: c.name,
            accounts: probe.status === "answered" ? probe.accounts : [],
          };
        })
      );
      // Mientras preguntábamos pudo conectarse algo (el propio reenganche de
      // wagmi, o la persona). El efecto se relanza y este intento se retira.
      if (cancelado) return;

      const elegido = pickCanonicalConnector(decision.canonical, probed);
      if (!elegido) return; // No se pudo demostrar: conexión manual, y ya.

      const connector = connectors.find((c) => c.id === elegido);
      if (!connector) return;
      // `reconnect`, no `connect`: es el único que promete no abrir ventanas.
      reconnectRef.current({ connectors: [connector] });
    })();

    return () => {
      cancelado = true;
    };
    // Solo VALORES, nunca objetos que cambien de identidad por render: un
    // relanzamiento de más aquí cancela el sondeo en vuelo y quema el intento.
  }, [
    inMiniPay,
    authenticated,
    isConnected,
    reconnecting,
    canonicalKey,
    embeddedAddress,
    connectors,
  ]);
}
