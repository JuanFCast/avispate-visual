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
  /**
   * Wallet EVM del jugador, en minúsculas, o null si no tiene ninguna.
   *
   * Es la embebida cuando entró por correo, y la externa cuando entró firmando
   * con su wallet (SIWE): ese jugador no tiene embebida, y quedarnos en null
   * lo dejaría sin dirección para premios y sin forma de reencontrarse con el
   * perfil que ya tenía.
   */
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
  const evm = linked.filter((a) => a.type === "wallet" && a.chainType === "ethereum");
  // La embebida manda cuando existe: es la que ya usan el ranking y los premios
  // de quien entró por correo, y cambiarla por una externa recién enlazada le
  // movería la identidad bajo los pies. Si no hay embebida, el jugador entró
  // firmando y su wallet externa ES su identidad.
  const wallet =
    evm.find((a) => a.walletClientType === "privy") ?? evm[0] ?? null;
  return {
    privyId: claims.userId,
    walletAddress: wallet?.address ? wallet.address.toLowerCase() : null,
  };
}
