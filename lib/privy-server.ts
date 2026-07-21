import { PrivyClient } from "@privy-io/server-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;

let client: PrivyClient | null = null;

function getPrivy(): PrivyClient {
  if (!appId || !appSecret) {
    throw new Error("Faltan NEXT_PUBLIC_PRIVY_APP_ID o PRIVY_APP_SECRET en el entorno.");
  }
  if (!client) client = new PrivyClient(appId, appSecret);
  return client;
}

export interface PrivyIdentity {
  /** DID de Privy (did:privy:...): identidad estable del jugador. */
  privyId: string;
  /** Wallet embebida EVM en minúsculas, o null si aún no está creada. */
  walletAddress: string | null;
}

interface LinkedAccountLike {
  type?: string;
  address?: string;
  walletClientType?: string;
  chainType?: string;
}

/**
 * Verifica el token de acceso de Privy y devuelve la identidad del jugador. La
 * wallet embebida se lee del usuario EN EL SERVIDOR (no de lo que envíe el
 * cliente), así no se puede falsificar. Lanza si el token es inválido.
 */
export async function verifyPrivyToken(token: string): Promise<PrivyIdentity> {
  const privy = getPrivy();
  const claims = await privy.verifyAuthToken(token);
  const user = await privy.getUserById(claims.userId);
  const linked = (user.linkedAccounts ?? []) as LinkedAccountLike[];
  const embedded = linked.find(
    (a) =>
      a.type === "wallet" &&
      a.walletClientType === "privy" &&
      a.chainType === "ethereum"
  );
  return {
    privyId: claims.userId,
    walletAddress: embedded?.address ? embedded.address.toLowerCase() : null,
  };
}
