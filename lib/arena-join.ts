"use client";

import { useCallback, useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useSwitchChain } from "wagmi";
import { celo } from "viem/chains";
import { ERC20_ABI, USDT_CELO_ADDRESS } from "./contracts";
import { resolveFeeCurrency, RECEIPT_TIMEOUT_MS } from "./celo-tx";
import { ensureAllowance, submitJoin } from "./arena-pay-sequence";
import { isMiniPay } from "./minipay";
import { decidePlayStart, confirmBeforeSigning } from "./pay-guard";
import { probeWallet } from "./wallet-access";
import { useCanonicalWallet } from "./wallet";
import { prepareSeat } from "./seat-secret";
import { registerSeat } from "./arena-register";
import { ensureWalletSession, readWalletSession } from "./wallet-session-client";
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

/**
 * Gas de la transacción más cara de este archivo (`join`, que además de
 * transferir escribe el estado de la mesa y el compromiso de la silla),
 * con holgura. Sin medir todavía con `scripts/gas-cost.mjs` — a propósito
 * más alto que el `PLAY_GAS_LIMIT` de `pay.ts` (150.000, medido para
 * `play()`) mientras no haya un número real: una cota prudente de más
 * solo hace que alguien con CELO justo pague el gas en USDT, que es
 * seguro; una de menos dejaría firmar en CELO a quien no le alcanza.
 */
const ARENA_TX_GAS_LIMIT = 220_000n;

export type JoinStage =
  | "checking"
  | "approving"
  | "confirm"
  | "confirming"
  | "registering"
  | "claiming";

/**
 * El recibo del `approve` no apareció a tiempo y, al comprobar la cadena
 * directamente, el permiso TODAVÍA no está. No es un rechazo: nada se firmó
 * mal, el nodo solo va lento. No hay nada que cobrar de nuevo —`approve` no
 * mueve USDT, solo autoriza— así que la salida es esperar y volver a
 * intentar, no repetir la firma a ciegas.
 */
class ApprovePendingError extends Error {
  constructor(readonly approveHash: string) {
    super("approve_pending");
    this.name = "ApprovePendingError";
  }
}

export interface ArenaJoinApi {
  stage: JoinStage | null;
  error: MessageKey | null;
  /**
   * Consigue la ficha de una silla que YA está registrada pero cuya ficha se
   * perdió. No firma, no cobra y no toca la cadena para escribir.
   */
  claimSeatToken: (params: {
    code: string;
    tableId: `0x${string}`;
    address: string;
  }) => Promise<boolean>;
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
 * La sesión, leída en el momento y no heredada de un closure.
 *
 * `authHeaders` viene del hook de la sala y se capturó cuando arrancó el pago,
 * con `authenticated` en falso si el jugador todavía no tenía sesión. Aunque la
 * sesión aparezca a mitad del camino —que es justo lo que hacemos ahora— esa
 * copia de la función sigue devolviendo cabeceras vacías para siempre.
 *
 * Así que si no trae `Authorization`, se mira `localStorage` directamente. Es
 * donde `ensureWalletSession` acaba de escribir, y no depende de que React haya
 * vuelto a renderizar nada.
 */
async function freshAuthHeaders(
  authHeaders: () => Promise<HeadersInit>
): Promise<HeadersInit> {
  const base = (await authHeaders()) as Record<string, string>;
  if (base.Authorization) return base;
  const session = readWalletSession();
  return session ? { ...base, Authorization: `Bearer ${session.token}` } : base;
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
 * Esto es solo el cableado: cuándo reintentar, cuándo rendirse y qué hacer con
 * un 401 lo decide `registerSeat`, que es puro y está probado aparte.
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

  const result = await registerSeat({
    onStage: setStage,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),

    postPaid: async () => {
      try {
        const res = await fetch(
          `/api/arena/rooms/${encodeURIComponent(code)}/paid`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(await freshAuthHeaders(authHeaders)),
            },
            body: JSON.stringify({ txHash, address: account }),
          }
        );
        return res.status;
      } catch {
        // Sin red no hay código HTTP. Un 0 no es 409 ni 401, así que cae en el
        // camino de "espera y vuelve a intentar", que es lo correcto.
        return 0;
      }
    },

    /**
     * La sesión que falta, sacada de la transacción que se acaba de pagar.
     *
     * Es el arreglo del agujero: dentro de MiniPay el jugador nuevo llega aquí
     * sin sesión, y su primera sesión sale precisamente de este pago.
     */
    recoverSession: () => ensureWalletSession(account, txHash),

    postSeat: async () => {
      try {
        const res = await fetch("/api/arena/seat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, address: account, secret }),
        });
        const data = (await res.json().catch(() => null)) as {
          token?: string;
        } | null;
        return res.ok ? (data?.token ?? null) : null;
      } catch {
        return null;
      }
    },
  });

  if (!result.ok) return false;

  rememberSeatToken(code, result.token);
  // Registrado y con ficha: ya no hay nada pendiente que reintentar.
  forgetSeatPayment(code);
  return true;
}

export function useArenaJoin(): ArenaJoinApi {
  const { address, chainId, connector } = useAccount();
  // La wallet del perfil, la que cobra el premio. Entra en el guardián para que
  // pagar una entrada exija la misma cuenta que va a recibir el pozo.
  const canonical = useCanonicalWallet();
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
        // `canonical`: además de accesible y estable, la wallet tiene que ser
        // la DEL PERFIL. Una embebida creada por accidente pasa los otros dos
        // filtros sin despeinarse (`wallet-identity.ts`).
        const decision = decidePlayStart({
          expected: address,
          probe: await probeWallet(connector),
          pending: null,
          canonical,
        });
        if (decision.kind !== "proceed") {
          setError(
            decision.kind === "reconnect"
              ? "pay.block.reconnect"
              : decision.kind === "wrong_wallet"
                ? "pay.block.wrong_wallet"
                : "pay.block.account_changed"
          );
          setStage(null);
          return false;
        }
        const account = decision.address as `0x${string}`;

        if (chainId !== celo.id) await switchChainAsync({ chainId: celo.id });

        // Con qué se paga el gas de TODO lo que sigue —approve y join—, en
        // una sola lectura para los dos. Misma política que el reto diario
        // (`lib/celo-tx.ts`): dentro de MiniPay siempre USDT, porque el
        // jugador tiene 0 CELO por diseño.
        const feeCurrency = await resolveFeeCurrency(
          publicClient,
          account,
          ARENA_TX_GAS_LIMIT,
          isMiniPay()
        );

        // 3. Permiso de USDT, solo si falta. La secuencia (leer, aprobar,
        //    esperar y recuperarse de un recibo lento) es la misma función
        //    pura que recorre `scripts/verify-arena-fee-currency.ts`.
        const allowanceResult = await ensureAllowance({
          entryUnits,
          feeCurrency,
          onApproving: () => setStage("approving"),
          readAllowance: () =>
            publicClient.readContract({
              address: USDT_CELO_ADDRESS as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "allowance",
              args: [account, ARENA_ESCROW_ADDRESS],
            }) as Promise<bigint>,
          approve: (fee) =>
            writeContractAsync({
              account,
              address: USDT_CELO_ADDRESS as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [ARENA_ESCROW_ADDRESS, entryUnits * 4n],
              chainId: celo.id,
              ...fee,
            }),
          waitApproveReceipt: async (hash) => {
            await publicClient.waitForTransactionReceipt({
              hash: hash as `0x${string}`,
              timeout: RECEIPT_TIMEOUT_MS,
            });
          },
        });
        if (allowanceResult.kind === "approve_pending") {
          throw new ApprovePendingError(allowanceResult.approveHash);
        }

        // 4. El pago. Última comprobación pegada a la firma.
        const verdict = confirmBeforeSigning(
          account,
          await probeWallet(connector),
          canonical
        );
        if (!verdict.ok) {
          setError(
            verdict.decision.kind === "wrong_wallet"
              ? "pay.block.wrong_wallet"
              : "pay.block.account_changed"
          );
          setStage(null);
          return false;
        }
        setStage("confirm");
        const txHash = await submitJoin({
          feeCurrency,
          join: (fee) =>
            writeContractAsync({
              account,
              address: ARENA_ESCROW_ADDRESS,
              abi: ARENA_ABI,
              functionName: "join",
              args: [tableId, entryUnits, maxPlayers, seat.commitment],
              chainId: celo.id,
              ...fee,
            }),
          waitJoinReceipt: async (hash) => {
            await publicClient.waitForTransactionReceipt({
              hash: hash as `0x${string}`,
              timeout: RECEIPT_TIMEOUT_MS,
            });
          },
          // El hash existe: el dinero ya salió. Se guarda ANTES de esperar su
          // recibo, por lo mismo que la bandeja del reto diario — cerrar la
          // pestaña aquí no puede dejar una silla pagada sin forma de
          // reclamarla. Un timeout después de esto YA no repite la firma:
          // `submitJoin` sigue con el hash, igual que el reto diario — el
          // registro que viene abajo (`registerAndClaim`) no depende de que
          // el recibo haya llegado, porque `registerSeat` ya reintenta
          // `recoverSession` en cada 401 si el nodo del servidor todavía no
          // ve la transacción minada.
          onJoinHash: (hash) => rememberSeatPayment(code, { txHash: hash, address: account }),
        });

        /**
         * Esta transacción también prueba quién eres.
         *
         * Importa dentro de MiniPay, donde no se puede firmar un mensaje: sin
         * esto había que jugar una partida del reto ANTES de poder entrar a una
         * sala, que es lo que Juan encontró absurdo probando. Pagar la entrada
         * abre la sesión igual de bien.
         *
         * Va DESPUÉS de esperar el recibo, y ese orden es el arreglo. Antes
         * salía en cuanto existía el hash, sin esperar a nada: el servidor
         * pedía el recibo de una transacción que todavía no estaba minada, no lo
         * encontraba y la sesión no se abría. Nadie lo reintentaba, así que el
         * paso siguiente —que sí pide sesión— se comía cinco 401 seguidos y
         * dejaba una silla pagada e imposible de registrar.
         *
         * Se espera el resultado en vez de soltarlo: no lanza nunca, tarda lo
         * que tarda una petición, y lo que sigue lo necesita. Si aun así falla
         * —el nodo del servidor puede ir detrás del nuestro—, `registerSeat`
         * vuelve a pedirla en cuanto vea el primer 401.
         */
        await ensureWalletSession(account, txHash);

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
          e instanceof ApprovePendingError
            ? "arena.pay.approve_pending"
            : /seat_store_unavailable/.test(msg)
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
    [address, canonical, chainId, connector, publicClient, switchChainAsync, writeContractAsync]
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

  /**
   * Recuperar solo la ficha.
   *
   * Hace falta para un caso real: la silla quedó registrada —a mano o por un
   * reintento— pero el canje nunca ocurrió, así que el jugador está sentado y
   * el servidor le rechaza cada acción por falta de ficha. El secreto sigue en
   * su dispositivo, que es lo único que hace falta.
   */
  const claimSeatToken = useCallback<ArenaJoinApi["claimSeatToken"]>(
    async ({ code, tableId, address }) => {
      try {
        const { secret } = prepareSeat(tableId);
        const res = await fetch("/api/arena/seat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, address, secret }),
        });
        const data = (await res.json().catch(() => null)) as {
          token?: string;
        } | null;
        if (!res.ok || !data?.token) return false;
        rememberSeatToken(code, data.token);
        forgetSeatPayment(code);
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  return { stage, error, payAndSit, finishPending, claimSeatToken };
}
