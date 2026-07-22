import { getSupabaseAdmin } from "./server";
import type { PrivyIdentity } from "../privy-server";

export interface ProfileRow {
  id: string;
  privy_id: string | null;
  wallet_address: string | null;
  alias: string | null;
}

const PROFILE_COLUMNS = "id, privy_id, wallet_address, alias";

/**
 * Crea el perfil si no existe (por `privy_id`) y actualiza la wallet embebida
 * cuando llega. No toca el alias. Devuelve el perfil actual.
 */
export async function ensureProfile(identity: PrivyIdentity): Promise<ProfileRow> {
  const db = getSupabaseAdmin();
  const patch: Record<string, string> = { privy_id: identity.privyId };
  // Solo escribimos la wallet cuando existe, para no borrar una ya guardada.
  if (identity.walletAddress) patch.wallet_address = identity.walletAddress;

  const { data, error } = await db
    .from("profiles")
    .upsert(patch, { onConflict: "privy_id" })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) throw error;
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
