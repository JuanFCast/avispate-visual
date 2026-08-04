import { getSupabaseAdmin } from "./server";
import type { AppIdentity } from "../identity";

export interface ProfileRow {
  id: string;
  privy_id: string | null;
  wallet_address: string | null;
  alias: string | null;
}

const PROFILE_COLUMNS = "id, privy_id, wallet_address, alias";

/** 23505 = índice único violado. Aquí sale por `privy_id` o por `wallet_address`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Crea o recupera el perfil de una identidad de Privy. No toca el alias.
 *
 * Lo interesante es el caso del jugador que YA existía sin correo.
 *
 * Antes de poder entrar a la Arena firmando, una wallet suelta ya tenía perfil:
 * lo crea `ensureProfileByWallet` en la primera jugada paga, con su alias y sus
 * puntajes, y sin `privy_id`. Cuando esa misma persona entra ahora firmando con
 * Privy, aparece con un `privy_id` nuevo y la MISMA wallet — y como
 * `wallet_address` es único, el upsert de antes chocaba (23505) y la sesión se
 * caía con un 500.
 *
 * Así que en vez de crear una fila nueva, se adopta la que ya estaba: se le
 * escribe el `privy_id` encima y el jugador conserva su alias y su historia.
 * Es lo que hace que "entrar con wallet" se sienta como volver y no como
 * empezar de cero.
 */
export async function ensureProfile(identity: AppIdentity): Promise<ProfileRow> {
  const db = getSupabaseAdmin();
  const wallet = identity.walletAddress ?? null;

  // Sesión de wallet (MiniPay): no hay `privy_id` que buscar ni que escribir —
  // la dirección es toda la identidad. Se atiende con el mismo camino que usan
  // las jugadas, así que un jugador de MiniPay y el mismo jugador entrando
  // luego con Privy convergen en la MISMA fila, por `wallet_address`.
  if (!identity.privyId) {
    if (!wallet) throw new Error("identidad sin privyId ni wallet");
    return await ensureProfileByWallet(wallet);
  }
  const privyId = identity.privyId;

  // 1. ¿Ya lo conocemos por su identidad de Privy? Es el camino normal.
  const { data: byPrivy, error: byPrivyError } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("privy_id", privyId)
    .maybeSingle();
  if (byPrivyError) throw byPrivyError;

  if (byPrivy) {
    const row = byPrivy as ProfileRow;
    if (!wallet || row.wallet_address === wallet) return row;
    const { data, error } = await db
      .from("profiles")
      .update({ wallet_address: wallet })
      .eq("id", row.id)
      .select(PROFILE_COLUMNS)
      .single();
    // La wallet ya es de otro perfil: se deja la que tenía. Perder la sesión
    // por no poder anotar una dirección sería peor que la dirección vieja.
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return row;
      throw error;
    }
    return data as ProfileRow;
  }

  // 2. Sin perfil de Privy, pero puede que la wallet ya tuviera el suyo.
  if (wallet) {
    const { data: byWallet, error: byWalletError } = await db
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("wallet_address", wallet)
      .maybeSingle();
    if (byWalletError) throw byWalletError;

    const orphan = byWallet as ProfileRow | null;
    if (orphan && orphan.privy_id === null) {
      const { data, error } = await db
        .from("profiles")
        .update({ privy_id: privyId })
        .eq("id", orphan.id)
        .is("privy_id", null)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as ProfileRow;
      // Otra petición lo adoptó primero: sirve el resultado de ella.
      return await readByPrivyId(privyId);
    }
    if (orphan) {
      // La wallet es la identidad de OTRA cuenta de Privy. No se le quita:
      // este jugador estrena perfil, sin dirección hasta que traiga una suya.
      return await insertProfile(privyId, null);
    }
  }

  return await insertProfile(privyId, wallet);
}

async function readByPrivyId(privyId: string): Promise<ProfileRow> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("privy_id", privyId)
    .single();
  if (error) throw error;
  return data as ProfileRow;
}

async function insertProfile(
  privyId: string,
  wallet: string | null
): Promise<ProfileRow> {
  const db = getSupabaseAdmin();
  const patch: Record<string, string> = { privy_id: privyId };
  if (wallet) patch.wallet_address = wallet;

  const { data, error } = await db
    .from("profiles")
    .insert(patch)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    // Dos peticiones del mismo jugador a la vez (pasa: la pantalla pide perfil
    // y estado a la par). La que perdió lee la fila de la que ganó.
    if (error.code === UNIQUE_VIOLATION) return await readByPrivyId(privyId);
    throw error;
  }
  return data as ProfileRow;
}

/**
 * Crea/obtiene el perfil de un jugador identificado por su WALLET (sin correo).
 * Se usa en jugadas pagas, donde el pago on-chain ya probó que la wallet es suya.
 * No toca el alias.
 */
export async function ensureProfileByWallet(
  walletAddress: string
): Promise<ProfileRow> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .upsert(
      { wallet_address: walletAddress.toLowerCase() },
      { onConflict: "wallet_address" }
    )
    .select(PROFILE_COLUMNS)
    .single();

  if (error) throw error;
  return data as ProfileRow;
}

/**
 * Fija el alias de un perfil si aún no tiene. Devuelve el estado resultante:
 * `ok` con el alias, `taken` si otro ya lo usa, o el alias actual si ya tenía.
 */
export async function setAliasIfEmpty(
  profileId: string,
  alias: string
): Promise<{ status: "ok" | "taken"; alias: string | null }> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .update({ alias })
    .eq("id", profileId)
    .is("alias", null)
    .select("alias")
    .maybeSingle();

  if (error) {
    // 23505 = índice único violado (alias ya tomado por otro jugador).
    if (error.code === "23505") return { status: "taken", alias: null };
    throw error;
  }
  return { status: "ok", alias: data?.alias ?? alias };
}
