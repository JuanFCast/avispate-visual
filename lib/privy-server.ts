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

  /**
   * Cuál de las enlazadas es la identidad, cuando hay más de una.
   *
   * Manda la EXTERNA. Antes mandaba la embebida, y esa preferencia estaba al
   * revés para el caso que de verdad duele: un jugador con su wallet de siempre
   * entra con la extensión bloqueada, Privy lo da por "usuario sin wallets" y le
   * crea una embebida — y desde ese instante el token resolvía a una dirección
   * recién nacida en vez de a la suya, la que tiene el historial y cobra los
   * premios (PipeRabby, 2026-08-07).
   *
   * Hoy `ensureProfile` no deja que eso pise la columna del perfil, pero eso es
   * un cerrojo, no una regla: bastaba con que el perfil no tuviera dirección
   * todavía para que la embebida accidental se volviera la canónica. Aquí se
   * arregla de raíz — si el jugador trajo una wallet suya, esa es su identidad.
   *
   * Quien entró solo por correo no tiene externa, así que sigue siendo la
   * embebida y nada cambia para él. Y quien ya tiene dirección en el perfil no
   * se ve afectado en ningún caso: `ensureProfile` nunca la sobrescribe.
   */
  const externa = evm.find(
    (a) => a.walletClientType !== undefined && a.walletClientType !== "privy"
  );
  const wallet = externa ?? evm.find((a) => a.walletClientType === "privy") ?? evm[0] ?? null;

  return {
    privyId: claims.userId,
    walletAddress: wallet?.address ? wallet.address.toLowerCase() : null,
  };
}
