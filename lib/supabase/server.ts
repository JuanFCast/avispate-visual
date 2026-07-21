import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cached: SupabaseClient | null = null;

/**
 * Cliente Supabase con SERVICE ROLE. Solo servidor: bypassa RLS, así que NUNCA
 * debe importarse en código de cliente. Se usa en las rutas `/api` después de
 * verificar el token de Privy. Las escrituras del navegador están bloqueadas
 * por RLS; toda escritura pasa por aquí.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno."
    );
  }
  if (!cached) {
    cached = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
