"use client";

import type { Connector } from "wagmi";
import type { WalletProbe } from "./pay-guard";

/**
 * Le pregunta a la wallet, de verdad, qué cuentas expone AHORA.
 *
 * No vale mirar la dirección que wagmi tiene guardada: esa es memoria del
 * navegador y sobrevive a que la extensión se bloquee sola, a que el jugador
 * cambie de cuenta y a que le revoque el permiso a la página. Antes de mover
 * dinero hay que hablar con la wallet.
 *
 * Se pregunta por dos vías porque los proveedores no se portan igual: unos
 * devuelven lista vacía al estar bloqueados, otros lanzan, otros se quedan
 * colgados. Cualquiera de los tres es "no lo sé", y no saber basta para no
 * cobrar — quien decide qué hacer con eso es `decidePlayStart`.
 */
export async function probeWallet(
  connector: Connector | undefined
): Promise<WalletProbe> {
  if (!connector) return { status: "unreachable", reason: "no_connector" };

  // 1. La vía de wagmi. Para los conectores inyectados acaba en `eth_accounts`.
  try {
    const accounts = await withTimeout(connector.getAccounts());
    if (Array.isArray(accounts)) {
      return { status: "answered", accounts: accounts as readonly string[] };
    }
  } catch {
    // Cae a la vía directa: algunos conectores lanzan cuando no hay sesión
    // aunque el proveedor sí sepa contestar.
  }

  // 2. El proveedor a pelo. Es lo que responde la extensión en persona.
  try {
    const provider = (await withTimeout(connector.getProvider())) as {
      request?: (args: { method: string }) => Promise<unknown>;
    };
    if (!provider?.request) {
      return { status: "unreachable", reason: "no_provider" };
    }
    const accounts = await withTimeout(
      provider.request({ method: "eth_accounts" })
    );
    if (Array.isArray(accounts)) {
      return { status: "answered", accounts: accounts as readonly string[] };
    }
    return { status: "unreachable", reason: "bad_accounts_reply" };
  } catch (e) {
    return {
      status: "unreachable",
      reason: e instanceof Error ? e.message.slice(0, 80) : "provider_error",
    };
  }
}

/**
 * Una wallet que no contesta no puede dejar el botón colgado para siempre. El
 * tope es generoso: se trata de distinguir "no responde" de "va lenta", no de
 * apurar a nadie.
 */
const PROBE_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("probe_timeout")), PROBE_TIMEOUT_MS)
    ),
  ]);
}
