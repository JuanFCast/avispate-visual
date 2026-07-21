import { getSupabaseAdmin } from "./server";
import type { PrivyIdentity } from "../privy-server";

export interface ProfileRow {
  id: string;
  privy_id: string;
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
