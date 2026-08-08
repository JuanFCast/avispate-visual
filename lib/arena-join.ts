"use client";

import { useCallback, useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useSwitchChain } from "wagmi";
import { celo } from "viem/chains";
import { ERC20_ABI, USDT_CELO_ADDRESS } from "./contracts";
import { decidePlayStart, confirmBeforeSigning } from "./pay-guard";
import { probeWallet } from "./wallet-access";
import { prepareSeat } from "./seat-secret";
import {
  forgetSeatPayment,
  rememberSeatPayment,
  rememberSeatToken,
  seatPaymentFor,
} from "./seat-token-client";
import type { MessageKey } from "./i18n";

/**
 * Pagar la entrada de una mesa de la Arena y quedar sentado.
 *
 * El recorrido completo, en el orden en que tiene que ocurrir:
 *
 *   1. guardar el secreto de la silla  (antes de nada que gaste dinero)
 *   2. comprobar la wallet             (accesible, y la dirección confirmada)
 *   3. permiso de USDT si hace falta
 *   4. `join` on-chain con la huella
 *   5. `/rooms/[code]/paid`            (el servidor lo verifica en la cadena)
 *   6. `/arena/seat`                   (canjea el secreto por la ficha)
 *
 * Los pasos 1 y 2 van antes del cobro por la misma razón que en el reto
 * diario: lo que puede costar dinero se comprueba con la plata todavía en la
 * wallet, no después. Y el 5 y el 6 se reintentan sin volver a pagar nunca —
 * desde que existe el txHash, lo único que falta es contarlo.
 */

export const ARENA_ESCROW_ADDRESS = (
  process.env.NEXT_PUBLIC_AVISPATE_ARENA_ADDRESS ?? ""
) as `0x${string}`;

const ARENA_ABI = [
  {
    type: "function",
    name: "join",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tableId", type: "bytes32" },
      { name: "entry", type: "uint256" },
      { name: "maxPlayers", type: "uint8" },
      { name: "seatCommitment_", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export type JoinStage =
  | "checking"
  | "approving"
  | "confirm"
  | "confirming"
  | "registering"
  | "claiming";

export interface ArenaJoinApi {
  stage: JoinStage | null;
  error: MessageKey | null;
  /**
   * Termina de registrar un pago que YA se hizo. No firma nada y no cobra: es
   * el camino para una silla pagada cuyo registro se cayó.
   */
  finishPending: (params: {
    code: string;
    tableId: `0x${string}`;
    authHeaders: () => Promise<HeadersInit>;
  }) => Promise<boolean>;
  /** Paga y se sienta. Devuelve true si quedó sentado con su ficha. */
  payAndSit: (params: {
    code: string;
    tableId: `0x${string}`;
    entryUnits: bigint;
    maxPlayers: number;
    authHeaders: () => Promise<HeadersInit>;
  }) => Promise<boolean>;
}


/**
 * Los pasos que van DESPUÉS del pago: contárselo al servidor y canjear la
 * ficha de la silla. Vive fuera del hook porque lo usan los dos caminos —el
 * pago normal y el reintento— y duplicarlo sería garantizar que un día se
 * arreglen solo en uno.
 *
 * Ninguno de los dos pasos cobra nada. Los dos son idempotentes: el primero por
 * el hash de la transacción, el segundo porque canjear una ficha ya emitida
 * devuelve otra igual de válida.
 *
 * Reintenta con espera creciente porque el fallo más común no es un error, es
 * que el nodo de Celo del servidor todavía no ve una transacción recién minada.
 */
async function registerAndClaim(params: {
  code: string;
  account: `0x${string}`;
  txHash: string;
  secret: string;
  authHeaders: () => Promise<HeadersInit>;
  setStage: (s: JoinStage | null) => void;
}): Promise<boolean> {
  const { code, account, txHash, secret, authHeaders, setStage } = params;

  setStage("registering");
  const registrar = async () =>
    fetch(`/api/arena/rooms/${encodeURIComponent(code)}/paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ txHash, address: account }),
    });

  let paid = await registrar();
  // ~30 s en total. La cadena tarda segundos en propagarse, no minutos.
  for (const espera of [1500, 3000, 5000, 8000, 12000]) {
    if (paid.ok) break;
    // Un 409 no se arregla esperando: es una silla ocupada o un pagador que no
    // coincide. Insistir solo retrasaría el aviso.
    if (paid.status === 409) break;
    await new Promise((r) => setTimeout(r, espera));
    paid = await registrar();
  }
  if (!paid.ok) return false;

  setStage("claiming");
  const canjear = async () =>
    fetch("/api/arena/seat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, address: account, secret }),
    });
  let claimed = await canjear();
  // La huella se lee de la cadena, así que hereda el mismo retraso.
  for (const espera of [1500, 3000, 5000]) {
    if (claimed.ok) break;
    await new Promise((r) => setTimeout(r, espera));
    claimed = await canjear();
  }

  const data = (await claimed.json().catch(() => null)) as { token?: string } | null;
  if (!claimed.ok || !data?.token) return false;

  rememberSeatToken(code, data.token);
  // Registrado y con ficha: ya no hay nada pendiente que reintentar.
  forgetSeatPayment(code);
  return true;
}

export function useArenaJoin(): ArenaJoinApi {
  const { address, chainId, connector } = useAccount();
  const publicClient = usePublicClient({ chainId: celo.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const [stage, setStage] = useState<JoinStage | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);

  const payAndSit = useCallback<ArenaJoinApi["payAndSit"]>(
    async ({ code, tableId, entryUnits, maxPlayers, authHeaders }) => {
      setError(null);
      setStage("checking");
      try {
        if (!publicClient) throw new Error("no_client");

        // 1. El secreto PRIMERO. Si no se puede guardar, no se paga: una silla
        //    pagada cuyo secreto se perdió es dinero que su dueño no puede
        //    reclamar hasta que la mesa venza.
        const seat = prepareSeat(tableId);

        // 2. La wallet: accesible y con la dirección confirmada. Mismo guardián
        //    que el reto diario, así que falla cerrado.
        const decision = decidePlayStart({
          expected: address,
          probe: await probeWallet(connector),
          pending: null,
        });
        if (decision.kind !== "proceed") {
          setError(
            decision.kind === "reconnect"
              ? "pay.block.reconnect"
              : "pay.block.account_changed"
          );
          setStage(null);
          return false;
        }
        const account = decision.address as `0x${string}`;

        if (chainId !== celo.id) await switchChainAsync({ chainId: celo.id });

        // 3. Permiso de USDT, solo si falta.
        const allowance = (await publicClient.readContract({
          address: USDT_CELO_ADDRESS as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account, ARENA_ESCROW_ADDRESS],
        })) as bigint;

        if (allowance < entryUnits) {
          setStage("approving");
          const approveHash = await writeContractAsync({
            account,
            address: USDT_CELO_ADDRESS as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [ARENA_ESCROW_ADDRESS, entryUnits * 4n],
            chainId: celo.id,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        // 4. El pago. Última comprobación pegada a la firma.
        const verdict = confirmBeforeSigning(account, await probeWallet(connector));
        if (!verdict.ok) {
          setError("pay.block.account_changed");
          setStage(null);
          return false;
        }
        setStage("confirm");
        const txHash = await writeContractAsync({
          account,
          address: ARENA_ESCROW_ADDRESS,
          abi: ARENA_ABI,
          functionName: "join",
          args: [tableId, entryUnits, maxPlayers, seat.commitment],
          chainId: celo.id,
        });

        // El hash existe: el dinero ya salió. Se guarda ANTES de esperar nada,
        // por lo mismo que la bandeja del reto diario — cerrar la pestaña aquí
        // no puede dejar una silla pagada sin forma de reclamarla.
        rememberSeatPayment(code, { txHash, address: account });

        setStage("confirming");
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        // 5 y 6. Contarlo y canjear la ficha. Mismo camino que el reintento.
        const ok = await registerAndClaim({
          code,
          account,
          txHash,
          secret: seat.secret,
          authHeaders,
          setStage,
        });
        if (!ok) {
          setError("arena.pay.registered_failed");
          setStage(null);
          return false;
        }

        setStage(null);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /seat_store_unavailable/.test(msg)
            ? "arena.pay.no_storage"
            : /reject|denied|cancel/i.test(msg)
              ? "pay.error.rejected"
              : /insufficient|exceeds balance|transfer amount/i.test(msg)
                ? "pay.error.insufficient"
                : "pay.error.generic"
        );
        setStage(null);
        return false;
      }
    },
    [address, chainId, connector, publicClient, switchChainAsync, writeContractAsync]
  );

  /**
   * Terminar de registrar un pago que ya se hizo. Es el camino que faltaba: sin
   * él, un registro caído dejaba al jugador delante de un botón de PAGAR, y
   * pagar otra vez es lo único que no debe hacer. Aquí no se firma nada.
   */
  const finishPending = useCallback<ArenaJoinApi["finishPending"]>(
    async ({ code, tableId, authHeaders }) => {
      const pago = seatPaymentFor(code);
      // Sin pago pendiente no hay nada que terminar, y decirlo como éxito
      // deja que la pantalla se recargue y muestre la silla.
      if (!pago) return true;

      setError(null);
      setStage("registering");
      try {
        // El secreto ya está guardado desde antes de pagar; `prepareSeat` lo
        // reutiliza y nunca sortea uno nuevo para una mesa que ya tiene.
        const { secret } = prepareSeat(tableId);
        const ok = await registerAndClaim({
          code,
          account: pago.address as `0x${string}`,
          txHash: pago.txHash,
          secret,
          authHeaders,
          setStage,
        });
        if (!ok) {
          setError("arena.pay.registered_failed");
          setStage(null);
          return false;
        }
        setStage(null);
        return true;
      } catch {
        setError("arena.pay.registered_failed");
        setStage(null);
        return false;
      }
    },
    []
  );

  return { stage, error, payAndSit, finishPending };
}
