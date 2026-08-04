/**
 * Quién es el jugador ante el servidor, venga por donde venga.
 *
 * Hay dos puertas y las dos son legítimas: la sesión de Privy (correo o SIWE),
 * que trae un `privyId` estable, y la sesión de wallet de MiniPay
 * (`wallet-session.ts`), que no tiene `privyId` porque ahí nunca hubo un login
 * de Privy — la identidad ES la dirección, probada por una transacción firmada.
 *
 * Por eso `privyId` es nullable: no es un hueco a rellenar, es la diferencia
 * entre las dos puertas. `ensureProfile` la usa para decidir si busca por
 * identidad de Privy o directamente por wallet.
 */
export interface AppIdentity {
  /** DID de Privy (did:privy:…), o null si entró por wallet sin firmar. */
  privyId: string | null;
  /** Wallet EVM en minúsculas, o null si el jugador aún no tiene ninguna. */
  walletAddress: string | null;
}
