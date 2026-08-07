"use client";

import { useCallback, useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useSwitchChain } from "wagmi";
import { celo } from "viem/chains";
import { ERC20_ABI, USDT_CELO_ADDRESS } from "./contracts";
import { decidePlayStart, confirmBeforeSigning } from "./pay-guard";
import { probeWallet } from "./wallet-access";
import { prepareSeat } from "./seat-secret";
import { rememberSeatToken } from "./seat-token-client";
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
  /** Paga y se sienta. Devuelve true si quedó sentado con su ficha. */
  payAndSit: (params: {
    code: string;
    tableId: `0x${string}`;
    entryUnits: bigint;
    maxPlayers: number;
    authHeaders: () => Promise<HeadersInit>;
  }) => Promise<boolean>;
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

        setStage("confirming");
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        // 5. Contarlo. A partir de aquí NUNCA se vuelve a pagar: si algo falla,
        //    se reintenta este paso, que es idempotente por el hash.
        setStage("registering");
        const paid = await fetch(
          `/api/arena/rooms/${encodeURIComponent(code)}/paid`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(await authHeaders()),
            },
            body: JSON.stringify({ txHash, address: account }),
          }
        );
        if (!paid.ok) {
          setError("arena.pay.registered_failed");
          setStage(null);
          return false;
        }

        // 6. La ficha de la silla. Sin sesión: la silla es de la dirección.
        setStage("claiming");
        const claimed = await fetch("/api/arena/seat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, address: account, secret: seat.secret }),
        });
        const data = (await claimed.json().catch(() => null)) as {
          token?: string;
        } | null;
        if (!claimed.ok || !data?.token) {
          setError("arena.pay.seat_failed");
          setStage(null);
          return false;
        }
        rememberSeatToken(code, data.token);

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

  return { stage, error, payAndSit };
}
